[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 or newer is required.' }
if (-not $IsWindows) { throw 'Agnes credential storage is supported on Windows only.' }

$target = 'ai-drama-leadgen-agnes'
$secure = Read-Host 'Paste the rotated Agnes API key' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($value)) { throw 'Agnes API key cannot be empty.' }
    if ($PSCmdlet.ShouldProcess($target, 'Store Agnes API key in Windows Credential Manager')) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CredentialWriter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  public static void Write(string target, string userName, string secret) {
    IntPtr blob = Marshal.StringToCoTaskMemUni(secret);
    try {
      var credential = new CREDENTIAL {
        Type = 1, TargetName = target, UserName = userName, Persist = 2,
        CredentialBlob = blob, CredentialBlobSize = (UInt32)(secret.Length * 2)
      };
      if (!CredWrite(ref credential, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      for (int offset = 0; offset < secret.Length * 2; offset += 2) Marshal.WriteInt16(blob, offset, 0);
      Marshal.FreeCoTaskMem(blob);
    }
  }
}
'@
        [CredentialWriter]::Write($target, 'agnes-api', $value)
        Write-Host "Stored Windows credential target: $target"
    }
}
finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $value = $null
    $secure.Dispose()
}
