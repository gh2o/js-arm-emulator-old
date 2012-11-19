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
		
		putU32: function (address, data) { return this.put (address, 'setUint32', 4, data); }
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
				throw "unaligned access";
			return this.pmem.getU32 (this.translate (address,
				ACC_READ | (execute ? ACC_EXEC : 0)));
		},
		putU32: function (address, data) {
			if (!this.creg.getM ())
				return this.pmem.putU32 (address, data);
			if (address % 4 != 0)
				throw "unaligned access";
			this.pmem.putU32 (this.translate (address, ACC_WRITE));
		},
		translate: function (address, access) {
		
			var flAddr = (this.regTable & 0xffffc000) | (address >>> 18);
			flAddr = (flAddr & 0xFFFFFFFC) >>> 0;
			
			var ap, dom, baddr, bmask;
			
			var flDesc = this.pmem.getU32 (flAddr);
			switch (flDesc & 0x03)
			{
				case 0:
					throw "page fault!";
				case 2:
					if ((flDesc & 0x000f8000) != 0)
						throw "bad page descriptor";
					ap = (flDesc >>> 10) & 0x03;
					dom = (flDesc >>> 5) & 0x0F;
					baddr = flDesc;
					bmask = 0xFFF00000;
					break;
				default:
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
			
			var ret = ((baddr & bmask) | (address & ~bmask)) >>> 0;
			if (address != ret)
				console.log (address.toString (16) + " -> " + ret.toString (16));
			return ret;
		},
	};
	
	return {
		PhysicalMemory: PhysicalMemory,
		VirtualMemory: VirtualMemory
	};
	
})();

if (typeof module === "object")
	module.exports = Mem;
