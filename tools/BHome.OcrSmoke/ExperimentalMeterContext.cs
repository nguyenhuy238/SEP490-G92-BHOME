using System.Security.Cryptography;
using System.Text.Json;
using BHome.Infrastructure.Ocr;
using BHome.Application.Ocr;
using OpenCvSharp;

// Caller-supplied public evaluation manifest only; never attached to API logging.
internal static class ExperimentalMeterContext
{
    public static async Task<int> Run(string models,string english,string manifest,string root,string output)
    {
        Directory.CreateDirectory(output);
        using var input=JsonDocument.Parse(await File.ReadAllTextAsync(manifest));
        var options=new OcrOptions { ModelDirectory=models };
        using var engine=new OnnxOcrEngine(options,new ImagePreprocessor(options));
        using var reader=new EnglishMeterTextRecognizer(english);var rows=new List<object>();
        foreach(var sample in input.RootElement.GetProperty("samples").EnumerateArray())
        {
            var path=Path.GetFullPath(Path.Combine(root,sample.GetProperty("image").GetString()!));
            if(!path.StartsWith(Path.GetFullPath(root)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase) ||
                !Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path))).Equals(sample.GetProperty("sha256").GetString(),StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Public source changed.");
            using var prepared=new ImagePreprocessor(options).PrepareUnclassified(await File.ReadAllBytesAsync(path));var image=prepared.Image;
            var lines=new List<object>();var evidence=new List<OcrLine>();var index=0;
            var detected=engine.InspectTextRegions(image,1280,default).Take(48).ToArray();
            var regions=detected.Select(r=>r.BoundingRect().Intersect(new Rect(0,0,image.Width,image.Height))).ToArray();
            foreach(var region in detected)
            {
                var bounds=region.BoundingRect().Intersect(new Rect(0,0,image.Width,image.Height));
                if(bounds.Width<2 || bounds.Height<2) continue;
                using var crop=new Mat(image,bounds);var line=reader.Recognize(crop,default).Line;
                evidence.Add(line with { Bounds=new(bounds.X,bounds.Y,bounds.Width,bounds.Height) });
                var expanded=ExperimentalMeterRecognizer.ExpandNumericRow(bounds,regions,image.Size());
                using var expandedImage=new Mat(image,expanded);var alternate=reader.Recognize(expandedImage,default).Line;
                var file=sample.GetProperty("id").GetString()+"-"+(index++)+".png";Cv2.ImWrite(Path.Combine(output,file),expandedImage);
                var pp=engine.InspectMeterCrop(crop,true,default).Lines.First();
                using var oriented=OnnxOcrEngine.Crop(image,region);
                var rectified=reader.Recognize(oriented,default);
                var rectifiedPp=engine.InspectMeterCrop(oriented,true,default).Lines.First();
                using var direct=OnnxOcrEngine.Crop(image,region,48);
                var directText=reader.Recognize(direct,default);
                lines.Add(new { line.Text,line.Confidence,ppRaw=pp.Text,ppConfidence=pp.Confidence,bounds=new[]{bounds.X,bounds.Y,bounds.Width,bounds.Height},expanded=alternate.Text,oriented=rectified.Line.Text,orientedConfidence=rectified.Line.Confidence,orientedMinimumScore=rectified.MinimumCharacterScore,direct=directText.Line.Text,directConfidence=directText.Line.Confidence,directMinimumScore=directText.MinimumCharacterScore,orientedPp=rectifiedPp.Text,orientedPpConfidence=rectifiedPp.Confidence,angle=region.Angle,activeInk=ExperimentalMeterRecognizer.HasActiveInk(expandedImage),crop=file });
            }
            // Isolate register evidence independently of the classifier's guess.
            // This controlled probe is not a new category prediction.
            var registerGate=ExperimentalRegisterSelection.Select(OcrDocumentKind.DigitalElectricity,evidence);
            rows.Add(new { id=sample.GetProperty("id").GetString(),lines,registerGate });
        }
        await File.WriteAllTextAsync(Path.Combine(output,"context.json"),JsonSerializer.Serialize(rows,new JsonSerializerOptions { WriteIndented=true }));return 0;
    }
}
