var ELF = require ("./elf.js");
var Mem = require ("./mem.js");
var CPU = require ("./cpu.js");
var FS = require ('fs');

var pmem = new Mem.PhysicalMemory ();
var cpu = new CPU.ARM (pmem);

var kernel = new ELF.Loader (new DataView (FS.readFileSync ("./buildroot/vmlinux")));
kernel.loadInto (pmem);
cpu.setPC (kernel.header.e_entry);

//pmem.putData (0xC0000000, new DataView (FS.readFileSync ("./buildroot/zImage")));
//cpu.setPC (0xC0000000);

while (true)
{
	var oldpc = cpu.pc.raw;
	cpu.tick ();
	var pc = cpu.pc.raw;
	if (pc == 0xc048d7e4 && pc == oldpc)
		break;
	/*
	try {
		cpu.tick ();
	} catch (e) {
		cpu.vmem.pmem.blocks.forEach (function (x, i) {
			if (x)
				console.log (i);
		})
		throw e;
	}
	*/
}
