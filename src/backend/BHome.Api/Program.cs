using BHome.Api.Configuration;
using BHome.Api.Middleware;
using BHome.Infrastructure;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(options => options.IncludeScopes = true);
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddApiFoundation(builder.Configuration);

var app = builder.Build();
app.UseMiddleware<CorrelationMiddleware>();
app.UseExceptionHandler();
app.UseStatusCodePages();
if (!app.Environment.IsDevelopment()) app.UseHsts();
if (app.Configuration.GetValue("Api:UseHttpsRedirection", true)) app.UseHttpsRedirection();
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
app.UseCors("Clients");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHealthChecks("/health/live", new() { Predicate = _ => false }).AllowAnonymous();
app.MapHealthChecks("/health/ready", new() { Predicate = check => check.Tags.Contains("ready") }).AllowAnonymous();
app.Run();

public partial class Program;
