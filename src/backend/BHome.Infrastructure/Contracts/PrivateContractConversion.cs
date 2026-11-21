using System.Diagnostics;
using System.Runtime.InteropServices;
using BHome.Application.Contracts;
using Microsoft.Extensions.Configuration;

namespace BHome.Infrastructure.Contracts;

// One isolated workspace/process per request. Never pass a URL, object key or tenant name to a shell.
internal static class PrivateContractConversion
{
    [DllImport("libc")] private static extern uint geteuid();
    [DllImport("libc")] private static extern uint getegid();
    private static readonly SemaphoreSlim Slots = new(2);
    public static async Task<byte[]> RunAsync(IConfiguration configuration, byte[] input, string inputName,
        string outputName, string? executable, string? entrypoint, string[] arguments, CancellationToken token)
    {
        var image = configuration["MainDraft:LibreOfficeContainerImage"];
        var container = !string.IsNullOrWhiteSpace(image);
        if (!container && (string.IsNullOrWhiteSpace(executable) || !File.Exists(executable)))
            throw new ContractException(503, entrypoint is null ? "contract_pdf_converter_unavailable" : "draft_preview_renderer_unavailable");
        await Slots.WaitAsync(token);
        var directory = Path.Combine(Path.GetTempPath(), "bhome-contract-" + Guid.NewGuid().ToString("N"));
        var containerName = "bhome-contract-convert-" + Guid.NewGuid().ToString("N");
        try
        {
            Directory.CreateDirectory(directory);
            if (OperatingSystem.IsLinux()) File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            await File.WriteAllBytesAsync(Path.Combine(directory, inputName), input, token);
            var start = new ProcessStartInfo(container ? "docker" : executable!) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            if (container)
            {
                foreach (var arg in new[] { "run", "--rm", "--name", containerName, "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=512m", "--cpus=1", "--pids-limit=128", "--tmpfs", "/tmp:rw,nosuid,size=256m", "--mount", $"type=bind,source={directory},target=/work" }) start.ArgumentList.Add(arg);
                if (OperatingSystem.IsLinux()) { start.ArgumentList.Add("--user"); start.ArgumentList.Add($"{geteuid()}:{getegid()}"); }
                if (entrypoint is not null) { start.ArgumentList.Add("--entrypoint"); start.ArgumentList.Add(entrypoint); }
                start.ArgumentList.Add(image!);
            }
            var work = container ? "/work" : directory;
            foreach (var argument in arguments) start.ArgumentList.Add(argument.Replace("{work}", work).Replace("{profile}", container ? "file:///tmp/profile" : new Uri(Path.Combine(directory, "profile")).AbsoluteUri));
            using var process = Start(start, entrypoint);
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
            deadline.CancelAfter(TimeSpan.FromSeconds(45));
            try { await process.WaitForExitAsync(deadline.Token); await Task.WhenAll(stdout, stderr); }
            catch (OperationCanceledException)
            {
                if (!process.HasExited) process.Kill(true);
                token.ThrowIfCancellationRequested();
                throw new ContractException(503, entrypoint is null ? "contract_pdf_conversion_timeout" : "draft_preview_timeout");
            }
            var output = Path.Combine(directory, outputName);
            if (process.ExitCode != 0 || !File.Exists(output) || new FileInfo(output).Length is < 5 or > 10_485_760)
                throw new ContractException(503, entrypoint is null ? "contract_pdf_conversion_failed" : "draft_preview_render_failed");
            return await File.ReadAllBytesAsync(output, token);
        }
        finally
        {
            try
            {
                if (container)
                {
                    var cleanup = new ProcessStartInfo("docker") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
                    foreach (var arg in new[] { "rm", "-f", containerName }) cleanup.ArgumentList.Add(arg);
                    try
                    {
                        using var process = Process.Start(cleanup);
                        if (process is not null)
                        {
                            var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
                            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                            try { await process.WaitForExitAsync(deadline.Token); await Task.WhenAll(stdout, stderr); }
                            catch (OperationCanceledException) { if (!process.HasExited) process.Kill(true); }
                        }
                    }
                    catch (System.ComponentModel.Win32Exception) { /* No container can exist when Docker is unavailable. */ }
                }
                if (Directory.Exists(directory)) Directory.Delete(directory, true);
            }
            finally { Slots.Release(); }
        }
    }
    private static Process Start(ProcessStartInfo start, string? entrypoint)
    {
        try { return Process.Start(start) ?? throw new ContractException(503, "draft_preview_render_failed"); }
        catch (System.ComponentModel.Win32Exception) { throw new ContractException(503, entrypoint is null ? "contract_pdf_converter_unavailable" : "draft_preview_renderer_unavailable"); }
    }
}
