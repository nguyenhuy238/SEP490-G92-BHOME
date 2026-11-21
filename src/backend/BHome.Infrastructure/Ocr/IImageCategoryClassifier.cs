using BHome.Application.Ocr;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

// Optional, thread-safe, in-process visual adapter. Disabled returns null;
// unavailable/unknown are distinct from a successful classification. Return all
// ambiguous candidates, never the highest score out of multiple visible objects.
public interface IImageCategoryClassifier
{
    OcrCategoryDecision? Classify(Mat preparedImage, CancellationToken token);
    void Warmup(CancellationToken token) { }
}
