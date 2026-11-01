using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using BHome.Application.PaymentsDebt;
using BHome.Domain.PaymentsDebt;
using QRCoder;

namespace BHome.Infrastructure.PaymentsDebt;

// Local transfer-to-account EMV/VietQR payload; no HTTP call, bank API or payment-success signal.
internal sealed class VietQrGenerator : ITransferQrGenerator
{
    internal static string? Payload(string bank,string account,decimal amount,string description)
    {
        if(!Regex.IsMatch(bank,"^[0-9]{6}$") || !Regex.IsMatch(account,"^[0-9]{6,19}$") || !PaymentRules.ValidMoney(amount) ||
            amount>9999999999999m || !Regex.IsMatch(description,"^[A-Za-z0-9 ]{1,25}$")) return null;
        static string Tag(string id,string data)=>id+data.Length.ToString("D2",CultureInfo.InvariantCulture)+data;
        var receiver=Tag("00",bank)+Tag("01",account);
        var consumer=Tag("00","A000000727")+Tag("01",receiver)+Tag("02","QRIBFTTA");
        var body=Tag("00","01")+Tag("01","12")+Tag("38",consumer)+Tag("53","704")+
            Tag("54",amount.ToString("0",CultureInfo.InvariantCulture))+Tag("58","VN")+Tag("62",Tag("08",description))+"6304";
        ushort crc=0xffff;
        foreach(var value in Encoding.ASCII.GetBytes(body))
        {
            crc^=(ushort)(value<<8);
            for(var bit=0;bit<8;bit++) crc=(ushort)((crc&0x8000)!=0?(crc<<1)^0x1021:crc<<1);
        }
        return body+crc.ToString("X4",CultureInfo.InvariantCulture);
    }
    public TransferQr? Generate(string bank,string account,decimal amount,string description)
    {
        var payload=Payload(bank,account,amount,description);if(payload is null)return null;
        using var data=QRCodeGenerator.GenerateQrCode(payload,QRCodeGenerator.ECCLevel.M);
        using var png=new PngByteQRCode(data);
        return new(payload,"data:image/png;base64,"+Convert.ToBase64String(png.GetGraphic(6)));
    }
}
