var Mem = (function () {

	var BLOCK_SIZE = 65536;
	
	var ACC_READ = 1;
	var ACC_WRITE = 2;
	var ACC_EXEC = 4;

	function copyBuffer (src, srci, dst, dsti, len)
	{
		src = new Uint8Array (src, srci, len);
		dst = new Uint8Array (dst, dsti, len);
		dst.set (src);
	}
	
	function PhysicalMemory ()
	{
		this.blocks = new Array (Math.pow (2,32) / BLOCK_SIZE);
	}
	
	PhysicalMemory.prototype = {
		addrToBlockNumber: function (address) {
			return Math.floor (address / BLOCK_SIZE);
		},
		addrToBlockOffset: function (address) {
			return address % BLOCK_SIZE;
		},
		blockNumberToBaseAddress: function (bn) {
			return bn * BLOCK_SIZE;
		},
		allocateBlock: function (bn) {
			if (this.blocks[bn])
				return (this.blocks[bn]);
			
			var addr = this.blockNumberToBaseAddress (bn);
			Util.debug ("mem", "block allocated for " + Util.hex32 (addr));
			
			var block = this.blocks[bn] = new ArrayBuffer (BLOCK_SIZE);
			block.dv = new DataView (block);
			return block;
		},
		putData: function (address, dv) {
		
			var size = dv.byteLength;
			if (size == 0)
				return;
			
			var firstBn = this.addrToBlockNumber (address);
			var lastBn = this.addrToBlockNumber (address + size - 1);
			
			// special case
			if (firstBn == lastBn)
			{
				var offset = this.addrToBlockOffset (address);
				copyBuffer (
					dv.buffer, dv.byteOffset,
					this.allocateBlock (firstBn), offset,
					size
				);
				return;
			}
			
			// do normal copy
			var position = 0;
			
			// copy first block
			var fOffset = this.addrToBlockOffset (address);
			var fSize = this.blockNumberToBaseAddress (firstBn + 1) - address;
			copyBuffer (
				dv.buffer, dv.byteOffset + position,
				this.allocateBlock (firstBn), fOffset,
				fSize
			);
			position += fSize;
			
			// copy middle blocks
			for (var bn = firstBn + 1; bn < lastBn; bn++)
			{
				copyBuffer (
					dv.buffer, dv.byteOffset + position,
					this.allocateBlock (bn), 0,
					BLOCK_SIZE
				);
				position += BLOCK_SIZE;
			}
			
			// copy last block
			copyBuffer (
				dv.buffer, dv.byteOffset + position,
				this.allocateBlock (lastBn), 0,
				size - position
			);
		},
		
		get: function (address, func, bytes) {
			
			//console.log ("read " + bytes + " bytes at " + address.toString (16));
		
			var bn = this.addrToBlockNumber (address);
			var off = this.addrToBlockOffset (address);
			if (off <= BLOCK_SIZE - bytes)
			{
				// does not cross page boundaries
				if (this.blocks[bn])
					return this.blocks[bn].dv[func](off, true);
				else
					return 0;
			}
			else
			{
				// crosses page boundaries
				throw "Cross-boundary access not implemented";
			}
		},
		
		getU8: function (address) { return this.get (address, 'getUint8', 1); },
		getU16: function (address) { return this.get (address, 'getUint16', 2); },
		getU32: function (address) { return this.get (address, 'getUint32', 4); },
		
		put: function (address, func, bytes, data) {

			//console.log ("write " + bytes + " bytes at " + address.toString (16));

			var bn = this.addrToBlockNumber (address);
			var off = this.addrToBlockOffset (address);
			if (off <= BLOCK_SIZE - bytes)
			{
				// does not cross page boundaries
				this.allocateBlock (bn).dv[func](off, data, true);
			}
			else
			{
				// crosses page boundaries
				throw "Cross-boundary access not implemented";
			}
		},
		
		putU8: function (address, data) { return this.put (address, 'setUint8', 1, data); },
		putU16: function (address, data) { return this.put (address, 'setUint16', 2, data); },
		putU32: function (address, data) { return this.put (address, 'setUint32', 4, data); },
	};
	
	function VirtualMemory (pmem, cpsr, creg)
	{
		this.pmem = pmem;
		this.cpsr = cpsr;
		this.creg = creg;
		
		this.regDomains = 0;
		this.regTable = 0;
	}
	
	VirtualMemory.prototype = {
		getU32: function (address, execute) {
			if (!this.creg.getM ())
				return this.pmem.getU32 (address);
			if (address % 4 != 0)
			{
				var ret = 0;
				for (var i = 0; i < 4; i++)
					ret |= this.getU8 (address + i) << (i * 8);
				return ret >>> 0;
			}
			return this.pmem.getU32 (this.translate (address,
				ACC_READ | (execute ? ACC_EXEC : 0)));
		},
		putU32: function (address, data) {
			if (!this.creg.getM ())
				return this.pmem.putU32 (address, data);
			if (address % 4 != 0)
			{
				for (var i = 0; i < 4; i++)
					this.putU8 (address + i, (data >>> (i * 8)) & 0xFF);
				return;
			}
			this.pmem.putU32 (this.translate (address, ACC_WRITE), data);
		},
		getU16: function (address) {
			if (!this.creg.getM ())
				return this.pmem.getU16 (address);
			if (address % 2 != 0)
				return this.getU8 (address) | (this.getU8 (address + 1) << 8);
			return this.pmem.getU16 (this.translate (address, ACC_READ));
		},
		putU16: function (address, data) {
			if (!this.creg.getM ())
				return this.pmem.putU16 (address, data);
			if (address % 2 != 0)
			{
				this.putU8 (address, data & 0xFF);
				this.putU8 (address + 1, (data >>> 8) * 0xFF);
				return;
			}
			this.pmem.putU16 (this.translate (address, ACC_WRITE), data);
		},
		getU8: function (address) {
			if (!this.creg.getM ())
				return this.pmem.getU8 (address);
			return this.pmem.getU8 (this.translate (address, ACC_READ));
		},
		putU8: function (address, data) {
			if (!this.creg.getM ())
				return this.pmem.putU8 (address, data);
			this.pmem.putU8 (this.translate (address, ACC_READ), data);
		},
		/*
		translate: function (address, access) {
		
			var flAddr = (this.regTable & 0xffffc000) | (address >>> 18);
			flAddr = (flAddr & 0xFFFFFFFC) >>> 0;
			
			var ap, dom, baddr, bmask;
			
			var flDesc = this.pmem.getU32 (flAddr);
			switch (flDesc & 0x03)
			{
				case 0:
					throw new Error ("page fault accessing 0x" + address.toString (16));
				case 2:
					if ((flDesc & 0x000f8000) != 0)
						throw "bad page descriptor";
					ap = (flDesc >>> 10) & 0x03;
					dom = (flDesc >>> 5) & 0x0F;
					baddr = flDesc;
					bmask = 0xFFF00000;
					break;
				default:
					Util.error ("mem", "unsupported page", Util.hex32 (flDesc));
					throw "unsupported page!";
			}
			
			var S = this.creg.getS (), R = this.creg.getR ();
			if (!S && !R && ap == 0)
				throw "permission fault!";
			
			var privPerm = 0, userPerm = 0;
			switch (ap)
			{
				case 0:
					if (!S && R)
						privPerm = userPerm = ACC_READ;
					else if (S && !R)
						privPerm = ACC_READ;
					break;
				case 1:
					privPerm = ACC_READ | ACC_WRITE;
					break;
				case 2:
					privPerm = ACC_READ | ACC_WRITE;
					userPerm = ACC_READ;
					break;
				case 3:
					privPerm = userPerm = ACC_READ | ACC_WRITE;
					break;
			}
			
			var perm = this.cpsr.isPrivileged () ? privPerm : userPerm;
			if (access & ~perm)
				throw "permission fault";
			
			// TODO: domains
			
			var ret = ((baddr & bmask) | (address & ~bmask)) >>> 0;
			if (address != ret)
				console.log (address.toString (16) + " -> " + ret.toString (16));
			return ret;
		},
		*/
		translate: function (address, access) {
		
			var flAddr = (this.regTable & 0xffffc000) | (address >>> 18);
			flAddr = (flAddr & 0xFFFFFFFC) >>> 0;
			
			var flDesc = this.pmem.getU32 (flAddr);
			switch (flDesc & 0x03)
			{
				case 0:
					throw new Error ("page fault accessing 0x" + address.toString (16));
				case 2:
					return this.translateSection (address, access, flDesc) >>> 0;
				case 1:
				case 3:
					return this.translateTable (address, access, flDesc) >>> 0;
			}
		},
		translateSection: function (address, access, desc) {
			var ap = (desc >>> 10) & 0x03;
			var domain = (desc >>> 5) & 0x0F;
			this.checkPermissions (access, domain, ap);
			var mask = 0xFFF00000;
			return (desc & mask) | (address & ~mask);
		},
		translateTable: function (address, access, desc) {
		
			var domain = (desc >>> 5) & 0x0F;
			
			var slAddr;
			if (desc && (1 << 1)) // fine
				slAddr = (desc & 0xFFFFF000) |
					((address >>> 8) & 0x00000FFC);
			else // course
				slAddr = (desc & 0xFFFFFC00) |
					((address >>> 10) & 0x000003FC);
			slAddr >>>= 0;
			
			var slDesc = this.pmem.getU32 (slAddr);
			
			var mask, apn;
			switch (slDesc & 0x03)
			{
				case 0:
					throw "page fault";
				case 1: // large page
					mask = 0xFFFF0000;
					apn = (slDesc >>> 14) & 0x03;
					break;
				case 2: // small page
					mask = 0xFFFFF000;
					apn = (slDesc >>> 10) & 0x03;
					break;
				case 3: // tiny page
					mask = 0xFFFFFC00;
					apn = 0;
					break;
			}
			
			var ap = (slDesc >>> (4 + apn * 2)) & 0x03;
			this.checkPermissions (access, domain, ap);
			
			return (slDesc & mask) | (address & ~mask);
		},
		checkPermissions: function (access, domain, ap) {
			var acb = (this.regDomains >>> (domain * 2)) & 0x03;
			switch (acb)
			{
				case 0: // domain fault
				case 2:
					throw "domain fault";
				case 3: // manager mode
					return;
			}
			
			// check AP
			var priv = this.cpsr.isPrivileged ();
			var S = this.creg.getS (), R = this.creg.getR ();
			if (S && R)
				throw "bad SR";
			
			var perms = 0;
			switch (ap)
			{
				case 0:
					if (S && !R)
						perms = priv ? ACC_READ : 0;
					else if (!S && R)
						perms = ACC_READ;
					break;
				case 1:
					perms = priv ? (ACC_READ | ACC_WRITE) : 0;
					break;
				case 2:
					perms = priv ? (ACC_READ | ACC_WRITE) : ACC_READ;
					break;
				case 3:
					perms = (ACC_READ | ACC_WRITE);
					break;
			}
			
			// FIXME: implement XN
			if (perms & ACC_READ)
				perms |= ACC_EXEC;
				
			if (access & ~perms)
				throw "permission fault";
		},
	};
	
	return {
		PhysicalMemory: PhysicalMemory,
		VirtualMemory: VirtualMemory
	};
	
})();

if (typeof module === "object")
	module.exports = Mem;
