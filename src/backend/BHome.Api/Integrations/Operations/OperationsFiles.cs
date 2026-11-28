using BHome.Application.Ocr;
using BHome.Application.Operations;
using BHome.Application.Storage;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

namespace BHome.Infrastructure.Modules.Operations;

internal sealed class OperationsFiles(IObjectStorage storage) : IOperationsFiles
{
    private const int MaximumBytes = 5 * 1024 * 1024;

    public string ValidateImage(byte[] content)
    {
        try
        {
            ImagePreprocessor.ValidateHeader(content, MaximumBytes, 12_000_000);
            using var image = Cv2.ImDecode(content, ImreadModes.Color);
            if (image.Empty()) throw OperationsException.Invalid("invalid_operations_image");
            return content[0] == 137 ? "image/png" : "image/jpeg";
        }
        catch (OcrInputException) { throw OperationsException.Invalid("invalid_operations_image"); }
        catch (OpenCVException) { throw OperationsException.Invalid("invalid_operations_image"); }
    }

    public async Task PutAsync(string key, byte[] content, string contentType, CancellationToken t)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        using var stream = new MemoryStream(content, false);
        await storage.PutAsync(key, stream, content.LongLength, contentType, deadline.Token);
    }

    public async Task CopyAsync(string key, Stream output, CancellationToken t)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        await storage.CopyToAsync(key, output, deadline.Token);
    }

    public async Task DeleteAsync(string key, CancellationToken t)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        await storage.DeleteAsync(key, deadline.Token);
    }
}
