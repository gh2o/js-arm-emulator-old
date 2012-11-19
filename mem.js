var Mem = (function () {

	var BLOCK_SIZE = 65536;

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
	
	return {
		PhysicalMemory: PhysicalMemory
	};
	
})();

if (typeof module === "object")
	module.exports = Mem;
