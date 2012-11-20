if (typeof require === "function")
	var Struct = require ('./struct.js');

var ELF = (function () {

	function Loader (dv)
	{
		this.dataView = dv;
	
		var str = Struct.createStruct ([
			["e_ident", "u8x16"],
			["e_type", "u16"],
			["e_machine", "u16"],
			["e_version", "u32"],
			["e_entry", "u32"],
			["e_phoff", "u32"],
			["e_shoff", "u32"],
			["e_flags", "u32"],
			["e_ehsize", "u16"],
			["e_phentsize", "u16"],
			["e_phnum", "u16"],
			["e_shentsize", "u16"],
			["e_shnum", "u16"],
			["e_shstrndx", "u16"]
		], true);
		
		this.header = str.unpack (dv);
		if (this.header.e_ident[4] != 1)
			throw "Only 32-bit ELF is supported";
		
		// load program headers
		if (this.header.e_phentsize != 32)
			throw "Incorrect program header entry size";
		
		var phstr = Struct.createStruct ([
			["headers", [
				["p_type", "u32"],
				["p_offset", "u32"],
				["p_vaddr", "u32"],
				["p_paddr", "u32"],
				["p_filesz", "u32"],
				["p_memsz", "u32"],
				["p_flags", "u32"],
				["p_align", "u32"],
			], this.header.e_phnum]
		], true);
		
		this.programHeaders = phstr.unpack (dv, this.header.e_phoff).headers;
	}
	
	Loader.prototype = {
		loadInto: function (pmem) {
			var loader = this;
			this.programHeaders.forEach (function (hdr, i) {
			
				// copy to p_filesz
				var odv = loader.dataView;
				var dv = new DataView (
					odv.buffer,
					odv.byteOffset + hdr.p_offset,
					hdr.p_filesz
				);
				pmem.putData (hdr.p_paddr, dv);
				
				// zero to p_memsz
				var zsz = hdr.p_memsz - hdr.p_filesz;
				if (zsz > 0)
					pmem.putData (
						hdr.p_paddr + hdr.p_filesz,
						new DataView (new ArrayBuffer (zsz))
					);
			});
		}
	};
	
	return {
		Loader: Loader
	};

})();

if (typeof module === "object")
	module.exports = ELF;
