import { mkdir, lstat, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const run = promisify(execFile);
const fail = () => { throw Object.assign(new Error('unsafe_private_storage'), {code:'unsafe_private_storage'}); };

// Static script: the path is data in the child environment, never PowerShell code.
// .NET Framework creates the directory with its protected DACL in one operation.
async function windowsAcl(file, create) {
 const script = `
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$target = $env:ZUZ_PRIVATE_PATH
if ($env:ZUZ_PRIVATE_CREATE -eq '1') {
 $acl = New-Object System.Security.AccessControl.DirectorySecurity
 $acl.SetOwner($sid)
 $acl.SetAccessRuleProtection($true, $false)
 $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
 $acl.AddAccessRule($rule)
 [System.IO.Directory]::CreateDirectory($target, $acl) | Out-Null
}
$actual = if ([System.IO.Directory]::Exists($target)) { [System.IO.Directory]::GetAccessControl($target) } else { [System.IO.File]::GetAccessControl($target) }
if ($actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner' }
$found = $false
foreach ($rule in $actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
 if ($rule.AccessControlType -eq 'Allow') {
  if ($rule.IdentityReference.Value -ne $sid.Value) { throw 'other principal' }
  if (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::ReadData) -ne 0) { $found = $true }
 }
}
if (-not $found) { throw 'missing owner access' }
`;
 const executable=path.join(process.env.SystemRoot ?? 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 try { await run(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{
  windowsHide:true,timeout:15000,maxBuffer:65536,
  env:{...process.env,ZUZ_PRIVATE_PATH:file,ZUZ_PRIVATE_CREATE:create?'1':'0'},
 }); } catch { fail(); }
}
export async function privateDirectory(directory) {
 if(process.platform==='win32') await windowsAcl(directory,true);
 else await mkdir(directory,{recursive:true,mode:0o700});
 const stat=await lstat(directory);
 if(!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory)!==directory) fail();
}
export async function assertPrivate(file) {
 const stat=await lstat(file);
 if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || await realpath(file)!==file) fail();
 if(process.platform==='win32') return windowsAcl(file,false);
 if((stat.mode & 0o077)!==0) fail();
}
