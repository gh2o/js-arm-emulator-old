var ELF = require ("./elf.js");
var Mem = require ("./mem.js");
var CPU = require ("./cpu.js");
var Util = require ("./util.js");
var FS = require ('fs');

var pmem = new Mem.PhysicalMemory ();
var cpu = new CPU.ARM (pmem);

var kernel = new ELF.Loader (new DataView (FS.readFileSync ("./buildroot/vmlinux")));
kernel.loadInto (pmem);
cpu.setPC (kernel.header.e_entry);

var fdt_loc = 0x10000000;
pmem.putData (fdt_loc, new DataView (FS.readFileSync ("./board.dtb")));
cpu.getReg (2).value = fdt_loc;

// setup ATAGs
/*
var atag_start = 1 << 20;
cpu.getReg (2).value = atag_start;

var ata = atag_start - 4;

pmem.putU32 (ata += 4, 5); // size of header in words
pmem.putU32 (ata += 4, 0x54410001); // ATAG_CORE
pmem.putU32 (ata += 4, 1); // flags
pmem.putU32 (ata += 4, 4096); // page size
pmem.putU32 (ata += 4, 0xff); // rootdev

pmem.putU32 (ata += 4, 4);
pmem.putU32 (ata += 4, 0x54410002); // ATAG_MEM
pmem.putU32 (ata += 4, 0x04000000); // size of memory
pmem.putU32 (ata += 4, 0x20000000); // start address

pmem.putU32 (ata += 4, 0);
pmem.putU32 (ata += 4, 0); // ATAG_NONE
*/

while (true)
{
	console.log (Util.hex32 (cpu.pc.raw));

	var oldpc = cpu.pc.raw;
	cpu.tick ();
	var pc = cpu.pc.raw;
	
	if (pc == oldpc)
	{
		console.log ("hang... @", Util.hex32 (pc));
		break;
	}
}
