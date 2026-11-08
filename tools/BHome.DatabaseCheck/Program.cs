using BHome.DatabaseCheck;

if (args.Length != 0)
{
    Console.Error.WriteLine("No arguments accepted. Supply ConnectionStrings__Database through secure local configuration.");
    return 1;
}
return await DatabaseProbe.RunAsync(Environment.GetEnvironmentVariable("ConnectionStrings__Database"), Console.Out);
