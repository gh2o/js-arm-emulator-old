var ELF = require ("./elf.js");
var Mem = require ("./mem.js");
var CPU = require ("./cpu.js");
var FS = require ('fs');

var kernel = new ELF.Loader (new DataView (FS.readFileSync ("./buildroot/vmlinux")));

var pmem = new Mem.PhysicalMemory ();
kernel.loadInto (pmem);

var cpu = new CPU.ARM (pmem);
cpu.setPC (kernel.header.e_entry);
while (true)
{
	cpu.tick ();
}
