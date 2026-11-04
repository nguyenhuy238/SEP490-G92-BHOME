using BHome.Application.Ocr;
using OpenCvSharp;

namespace BHome.Infrastructure.Ocr;

// Optional, thread-safe, in-process visual adapter. Intentionally unregistered:
// no licensed/evaluated six-class weights exist in the repository. Return all
// ambiguous candidates, never the highest score out of multiple visible objects.
public interface IImageCategoryClassifier
{
    OcrCategoryDecision Classify(Mat preparedImage, CancellationToken token);
}
