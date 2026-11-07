using BHome.Application.Ocr;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

public sealed class ExperimentalMeterRecognizer : IDisposable
{
    private readonly OcrOptions options;
    private readonly bool development;
    private readonly ExperimentalVisualMeterClassifier classifier;
    private readonly Lazy<EnglishMeterTextRecognizer> reader;
    public ExperimentalMeterRecognizer(OcrOptions options, ExperimentalVisualMeterClassifier classifier, bool development)
    {
        this.options=options;this.classifier=classifier;this.development=development;
        reader=new(()=>new EnglishMeterTextRecognizer(options.ExperimentalMeter.EnglishModelDirectory));
    }
    public ExperimentalMeterOcrResult Recognize(Mat image, OnnxOcrEngine detector, CancellationToken token)
    {
        if(!development || !options.ExperimentalMeter.Enabled) return ExperimentalMeterOcrResult.Unavailable("experimental_ocr_disabled");
        var visual=classifier.Classify(image,token);
        var category=visual.Guess is {} guess?OcrCategories.Name(guess):null;
        ExperimentalMeterOcrResult Fallback(string warning,string state="unknown",string register="unverified") =>
            new("review_required",visual.Decision,category,null,state,register,["experimental_ocr",warning]);
        if(visual.Guess is not {} kind) return Fallback("category_unknown");
        if(!options.ExperimentalMeter.Categories.Contains(kind)) return Fallback("experimental_category_disabled");
        if(kind is not (OcrDocumentKind.DigitalElectricity or OcrDocumentKind.DigitalWater)) return Fallback("experimental_reader_unsupported_for_category");
        var lines=new List<OcrLine>();var activeNumeric=false;
        var regions=detector.InspectTextRegions(image,1280,token).Take(options.MaxTextRegions)
            .Select(r=>r.BoundingRect().Intersect(new Rect(0,0,image.Width,image.Height))).Where(r=>r.Width>=2 && r.Height>=2).ToArray();
        foreach(var bounds in regions)
        {
            token.ThrowIfCancellationRequested();
            using var window=new Mat(image,bounds);
            var text=reader.Value.Recognize(window,token).Line;
            if(text.Text.Length==0) continue;
            var line=text with { Bounds=new(bounds.X,bounds.Y,bounds.Width,bounds.Height) };
            // Margin is based on the observed row height and real pixels. Read
            // the complete region again, never append or infer missing digits.
            if(text.Text.All(c=>c is >= '0' and <= '9' or '.' or ','))
            {
                var expanded=ExpandNumericRow(bounds,regions,image.Size());
                using var expandedImage=new Mat(image,expanded);
                var alternate=reader.Value.Recognize(expandedImage,token).Line;
                if(!HasActiveInk(expandedImage)) continue;
                activeNumeric=true;
                line=alternate with { Bounds=new(expanded.X,expanded.Y,expanded.Width,expanded.Height) };
            }
            lines.Add(line);
        }
        var selected=ExperimentalRegisterSelection.Select(kind,lines);
        if(selected.Candidate is not {} candidate) return Fallback(selected.Warnings[0],activeNumeric?"readable_candidate":"unreadable_or_unverified",selected.Status);
        return new("review_required",visual.Decision,category,candidate.Text,"readable_candidate",selected.Status,
            [..selected.Warnings,"category_requires_human_review"],candidate.Bounds);
    }
    internal static Rect ExpandNumericRow(Rect row,IReadOnlyList<Rect> regions,Size size)
    {
        var margin=(int)Math.Ceiling(row.Height*.5);var left=Math.Max(0,row.Left-margin);var right=Math.Min(size.Width,row.Right+margin);
        foreach(var other in regions)
        {
            if(other==row || Math.Abs(other.Y+other.Height/2d-row.Y-row.Height/2d)>Math.Min(row.Height,other.Height)*.4) continue;
            if(other.Right<=row.Left) left=Math.Max(left,other.Right);
            if(other.Left>=row.Right) right=Math.Min(right,other.Left);
        }
        return new(left,row.Y,right-left,row.Height);
    }
    // Filled active strokes and hollow inactive segment outlines have different
    // topology. Numeric88888 is never itself a blank-screen rule.
    internal static bool HasActiveInk(Mat image)
    {
        using var gray=new Mat(); Cv2.CvtColor(image,gray,ColorConversionCodes.BGR2GRAY);
        using var blurred=new Mat(); Cv2.GaussianBlur(gray,blurred,new Size(0,0),3);
        using var difference=new Mat(); Cv2.Absdiff(gray,blurred,difference);
        var contrasts=new List<byte>(gray.Width*gray.Height);
        for(var y=0;y<gray.Height;y++) for(var x=0;x<gray.Width;x++) contrasts.Add(difference.At<byte>(y,x));
        contrasts.Sort(); if(contrasts.Count==0 || contrasts[(int)((contrasts.Count-1)*.95)]<4) return false;
        using var mask=new Mat();Cv2.Threshold(gray,mask,0,255,ThresholdTypes.Binary|ThresholdTypes.Otsu);
        if(Cv2.CountNonZero(mask)>mask.Width*mask.Height/2) Cv2.BitwiseNot(mask,mask);
        Cv2.FindContours(mask,out Point[][] contours,out HierarchyIndex[] hierarchy,RetrievalModes.CComp,ContourApproximationModes.ApproxSimple);
        var holes=0;var h=gray.Height;
        for(var i=0;i<contours.Length;i++)
        { var area=Math.Abs(Cv2.ContourArea(contours[i])); if(hierarchy[i].Parent>=0 && area>=.0005*h*h && area<=.025*h*h) holes++; }
        var glyphs=Math.Max(1,Math.Round(gray.Width/(.65*h)));
        return holes/glyphs<3;
    }
    public void Dispose() { if(reader.IsValueCreated) reader.Value.Dispose(); }
    public void Warmup(CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if(!development || !options.ExperimentalMeter.Enabled) return;
        classifier.Warmup(token);
        try { _=reader.Value; }
        catch(Exception e) when(e is IOException or InvalidDataException or UnauthorizedAccessException or Microsoft.ML.OnnxRuntime.OnnxRuntimeException) { }
    }
}
