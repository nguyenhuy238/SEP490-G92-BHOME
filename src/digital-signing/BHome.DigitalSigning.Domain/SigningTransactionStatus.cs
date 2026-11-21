namespace BHome.DigitalSigning.Domain;

// Pending: the hash is at Viettel, waiting for the signer to confirm on the MySign app.
// Signing: the signature came back and is being embedded (guards against embedding twice).
public enum SigningTransactionStatus
{
    Pending,
    Signing,
    Signed,
    Rejected,
    Expired,
    Failed
}
