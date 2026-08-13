import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const credentialCache = new Map<string, { expiresAt: number; value: Promise<string | null> }>();

export async function hasWindowsCredential(target: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync("cmdkey", ["/list"], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.toLowerCase().includes(`target=${target}`.toLowerCase());
  } catch {
    return false;
  }
}

const READ_CREDENTIAL_SCRIPT = String.raw`
$Target = $env:DRAMA_CREDENTIAL_TARGET
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", SetLastError=true)] private static extern void CredFree(IntPtr credential);
  public static string Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) return null;
    try {
      var credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      return credential.CredentialBlobSize == 0 ? "" : Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2);
    } finally { CredFree(pointer); }
  }
}
'@
$value = [CredentialReader]::Read($Target)
if ($null -eq $value) { exit 2 }
[Console]::Out.Write($value)
`;

export async function readWindowsCredential(target: string): Promise<string | null> {
  if (process.platform !== "win32") return null;
  const cached = credentialCache.get(target);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = (async () => {
    try {
      const { stdout } = await execFileAsync(
        "pwsh",
        ["-NoProfile", "-NonInteractive", "-Command", READ_CREDENTIAL_SCRIPT],
        {
          windowsHide: true,
          timeout: 10_000,
          maxBuffer: 16 * 1024,
          env: { ...process.env, DRAMA_CREDENTIAL_TARGET: target },
        },
      );
      return stdout || null;
    } catch {
      return null;
    }
  })();
  credentialCache.set(target, { expiresAt: Date.now() + 30_000, value });
  return value;
}
