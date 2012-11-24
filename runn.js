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

//var fdt_loc = 0x10000000;
//pmem.putData (fdt_loc, new DataView (FS.readFileSync ("./board.dtb")));
//cpu.getReg (2).value = fdt_loc;

// setup ATAGs
/*
var atag_start = 0x04000000;
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
pmem.putU32 (ata += 4, 0x04000000); // start address

pmem.putU32 (ata += 4, 0);
pmem.putU32 (ata += 4, 0); // ATAG_NONE
*/

cpu.getReg (1).value = 0x00000183;
cpu.getReg (2).value = 0xd0000000;

var i = 0;
while (true)
{
//	if (cpu.pc.raw >= 0xc02c648c && cpu.pc.raw < 0xc02c6760)
//		console.log (Util.hex32 (cpu.pc.raw));
//	if (cpu.pc.raw == 0xc0079f30)
/*
	if (cpu.pc.raw >= 0xc0056f9c && cpu.pc.raw < 0xc0057034) // __zone_watermark_ok => 0
	{
		console.log (cpu.getRegs ());
		console.log (Util.hex32 (cpu.pc.raw));
	}
	if (cpu.pc.raw == 0xc0057020 || cpu.pc.raw == 0xc0057028 || cpu.pc.raw == 0xc0057030)
	{
		console.log ("break");
		break;
	}
*/
//	console.log (Util.hex32 (cpu.pc.raw));
/*
	if (cpu.pc.raw == 0xc0056fe4)
	{
		console.log ("feh " + Util.hex32 (cpu.getReg (2).value) +
			" + " + Util.hex32 (cpu.getReg (3).value));
	}
	if (cpu.pc.raw == 0xc0056fe8)
	{
		console.log ("blah " + Util.hex32 (cpu.getReg (4).value) +
			" <= " + Util.hex32 (cpu.getReg (3).value));
	}
*/
	// check banks
	/*
	if (cpu.pc.raw == 0xc02ca7b4)
	{
		console.log ("start bank");
		for (var i = 0xc0307bd4; i < 0xc0307c38; i += 4)
			console.log (Util.hex32 (cpu.vmem.pmem.getU32 (i)));
		console.log ("end bank");
	}
	*/

	var oldpc = cpu.pc.raw;
	cpu.tick ();
	var pc = cpu.pc.raw;
	
	if (pc == oldpc)
	{
		console.log ("hang... @", Util.hex32 (pc));
		break;
	}
}
