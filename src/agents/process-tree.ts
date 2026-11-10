import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import type * as KoffiModule from 'koffi';

const nodeRequire = createRequire(import.meta.url);
type Koffi = typeof KoffiModule;

const TH32CS_SNAPPROCESS = 0x2;

type Snapshot = () => Map<number, number>;
let win32Snapshot: Snapshot | undefined;

/** Snapshot of all processes as pid → parent pid. Empty on any error. */
export async function processParents(): Promise<Map<number, number>> {
  try {
    return process.platform === 'win32' ? win32Parents() : await psParents();
  } catch {
    return new Map();
  }
}

function win32Parents(): Map<number, number> {
  win32Snapshot ??= createWin32Snapshot();
  return win32Snapshot();
}

function createWin32Snapshot(): Snapshot {
  const koffi = nodeRequire('koffi') as Koffi;
  const kernel32 = koffi.load('kernel32.dll');
  const ENTRY = koffi.struct('VB_PROCESSENTRY32W', {
    dwSize: 'uint32',
    cntUsage: 'uint32',
    th32ProcessID: 'uint32',
    th32DefaultHeapID: 'uintptr_t',
    th32ModuleID: 'uint32',
    cntThreads: 'uint32',
    th32ParentProcessID: 'uint32',
    pcPriClassBase: 'int32',
    dwFlags: 'uint32',
    szExeFile: koffi.array('uint16', 260),
  });
  const size = koffi.sizeof(ENTRY);
  const createSnapshot = kernel32.func(
    'void * __stdcall CreateToolhelp32Snapshot(uint32 dwFlags, uint32 th32ProcessID)',
  );
  const first = kernel32.func(
    'bool __stdcall Process32FirstW(void *hSnapshot, _Inout_ VB_PROCESSENTRY32W *lppe)',
  );
  const next = kernel32.func(
    'bool __stdcall Process32NextW(void *hSnapshot, _Inout_ VB_PROCESSENTRY32W *lppe)',
  );
  const closeHandle = kernel32.func('bool __stdcall CloseHandle(void *hObject)');

  return () => {
    const parents = new Map<number, number>();
    const handle: unknown = createSnapshot(TH32CS_SNAPPROCESS, 0);
    if (!handle) return parents;
    try {
      const entry = { dwSize: size } as {
        dwSize: number;
        th32ProcessID: number;
        th32ParentProcessID: number;
      };
      for (let ok = first(handle, entry) as boolean; ok; ok = next(handle, entry) as boolean) {
        parents.set(entry.th32ProcessID, entry.th32ParentProcessID);
        entry.dwSize = size;
      }
    } finally {
      closeHandle(handle);
    }
    return parents;
  };
}

function psParents(): Promise<Map<number, number>> {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid='], (err, stdout) => {
      const parents = new Map<number, number>();
      if (!err) {
        for (const line of stdout.split('\n')) {
          const [pid, ppid] = line.trim().split(/\s+/).map(Number);
          if (pid && ppid !== undefined && !Number.isNaN(ppid)) parents.set(pid, ppid);
        }
      }
      resolve(parents);
    });
  });
}
