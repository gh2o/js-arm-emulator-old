var CPUInst = (function () {

	function rotRight (val, sht)
	{
		return ((val >>> sht) | (val << (32 - sht))) >>> 0;
	}
	
	function bitCount (x)
	{
		x = ((x >>> 1) & 0x55555555) + (x & 0x55555555);
		x = ((x >>> 2) & 0x33333333) + (x & 0x33333333);
		x = ((x >>> 4) + x) & 0x0F0F0F0F;
		x = ((x >>> 8) + x) & 0x00FF00FF;
		x = ((x >>> 16) + x) & 0x0000FFFF;
		return x;
	}

	function makeInstructionPredecoder (specs)
	{
		var loaders = {};
	
		for (var name in specs)
		{
			if (!specs.hasOwnProperty (name))
				continue;
			var spec = specs[name];
			
			var loader;
			if (typeof spec == "number")
			{
				loader = makeBitLoader (spec);
			}
			else
			{
				var upper = spec[0];
				var lower = spec[1];
				if (name.match (/^R[a-z]$/))
					loader = makeRegisterLoader (upper, lower);
				else
					loader = makeBitRangeLoader (upper, lower);
			}
			loaders[name] = loader;
		}
		
		return function (inst) {
			var ret = {};
			for (var name in loaders)
				if (loaders.hasOwnProperty (name))
					ret[name] = loaders[name].call (this, inst);
			return ret;
		};
		
		function makeBitLoader (bit)
		{
			if (bit < 0 || bit >= 32)
				throw "bit out of range";
			return function (inst) { return !!(inst & (1 << bit)) };
		}
		
		function makeBitRangeLoader (upper, lower)
		{
			if (lower < 0 || upper >= 32)
				throw "bits out of range";
			if (upper <= lower)
				throw "upper bit must be greater than lower bit";
			
			var length = (upper - lower) + 1;
			var mask = (1 << length) - 1;
			return function (inst) { return (inst >>> lower) & mask; };
		}
		
		function makeRegisterLoader (upper, lower)
		{
			if (lower < 0 || upper >= 32)
				throw "bits out of range";
			if (upper - lower != 3)
				throw "register must be 4 bits in length";
			return function (inst) {
				return this.getReg ((inst >>> lower) & 0x0F);
			}
		}
	}
	
	function opcodesAddrMode1 (opcode, cmp)
	{
		var oc = opcode << 21;
		var cp = cmp ? (1 << 20) : 0;
		
		return [
			// value, mask
			0x02000000 | oc | cp, 0x0fe00000 | cp,
			0x00000000 | oc | cp, 0x0fe00010 | cp,
			0x00000010 | oc | cp, 0x0fe00090 | cp,
		];
	}
	
	var predecodeAddrMode1 = makeInstructionPredecoder ({
		I: 25, S: 20,
		Rn: [19, 16], Rd: [15, 12], Rm: [3, 0], Rs: [11, 8],
		rotate_imm: [11, 8], immed_8: [7, 0],
		shift_imm: [11, 7], shift: [6, 5],
		use_shift_reg: 4,
	});
	
	function decodeAddrMode1 (inst)
	{
		var p = predecodeAddrMode1.call (this, inst);
		
		var shifter_operand = 0;
		var shifter_carry_out = false;
		
		if (p.I)
		{
			// immediate
			shifter_operand = rotRight (p.immed_8, p.rotate_imm * 2);
			shifter_carry_out = (p.rotate_imm == 0) ?
				this.cpsr.getC () : !!(shifter_operand & (1 << 31));
		}
		else
		{
			var s;
			if (p.use_shift_reg)
			{
				s = p.Rs.value & 0xFF;
			}
			else
			{
				var si = p.shift_imm;
				if (si != 0)
					s = si;
				else
					s = [0, 32, 32, null][p.shift];
			}
			
			switch (p.shift)
			{
				case 0:
					if (s == 0)
					{
						shifter_operand = p.Rm.value;
						shifter_carry_out = this.cpsr.getC ();
					}
					else if (s < 32)
					{
						shifter_operand = p.Rm.value << s;
						shifter_carry_out = !!(p.Rm.value & (1 << (32 - s)));
					}
					else if (s == 32)
					{
						shifter_carry_out = !!(p.Rm.value & (1 << 0));
					}
					break;
				case 1:
					if (s == 0)
					{
						shifter_operand = p.Rm.value;
						shifter_carry_out = this.cpsr.getC ();
					}
					else if (s < 32)
					{
						shifter_operand = p.Rm.value >>> s;
						shifter_carry_out = !!(p.Rm.value & (1 << (s - 1)));
					}
					else if (s == 32)
					{
						shifter_carry_out = !!(p.Rm.value & (1 << 31));
					}
					break;
				case 2:
					if (s == 0)
					{
						shifter_operand = p.Rm.value;
						shifter_carry_out = this.cpsr.getC ();
					}
					else if (s < 32)
					{
						shifter_operand = p.Rm.value >> s;
						shifter_carry_out = !!(p.Rm.value & (1 << (s - 1)));
					}
					else
					{
						shifter_carry_out = !!(p.Rm.value & (1 << 31));
						shifter_operand = shifter_carry_out ? 0xFFFFFFFF : 0;
					}
					break;
				case 3:
					var ss = s & 0x1F;
					if (s === null)
					{
						var C = Number (cpsr.getC ());
						shifter_operand = (C << 31) | (p.Rm.value >>> 1);
						shifter_carry_out = !!(p.Rm.value & (1 << 0));
					}
					else if (s == 0)
					{
						shifter_operand = p.Rm.value;
						shifter_carry_out = this.cpsr.getC ();
					}
					else if (ss == 0)
					{
						shifter_operand = p.Rm.value;
						shifter_carry_out = !!(p.Rm.value & (1 << 31));
					}
					else
					{
						shifter_operand = rotRight (p.Rm.value, ss);
						shifter_carry_out = !!(p.Rm.value & (1 << (ss - 1)));
					}
					break;
			}
		}
		
		p.shifter_operand = shifter_operand;
		p.shifter_carry_out = shifter_carry_out;
		return p;
	}

	function opcodesAddrMode2 (B, L)
	{
		B = B ? (1 << 22) : 0;
		L = L ? (1 << 20) : 0;
		
		return [
			// value, mask
			0x04000000 | B | L, 0x0e500000,
			0x06000000 | B | L, 0x0e500ff0,
			0x06000000 | B | L, 0x0e500010,
		];
	}
	
	var predecodeAddrMode2 = makeInstructionPredecoder ({
		I: 25, P: 24, U: 23, B: 22, W: 21, L: 20,
		Rn: [19, 16], Rd: [15, 12], Rm: [3, 0],
		offset_12: [11, 0],
		shift_imm: [11, 7], shift: [6, 5],
	});
	
	function decodeAddrMode2 (inst)
	{
		var p = predecodeAddrMode2.call (this, inst);
	
		var index;
		if (p.I)
		{
			// (scaled) register offset
			if (p.shift_imm == 0)
			{
				switch (p.shift)
				{
					case 0:
						index = p.Rm.value;
						break;
					case 1:
						index = 0;
						break;
					case 2:
						index = (p.Rm.value & (1 << 31)) ? 0xFFFFFFFF : 0;
						break;
					case 3:
						var C = Number (cpsr.getC ());
						index = (C << 31) | (p.Rm.value >>> 1);
						break;
				}
			}
			else
			{
				switch (p.shift)
				{
					case 0: index = p.Rm.value << p.shift_imm; break;
					case 1: index = p.Rm.value >>> p.shift_imm; break;
					case 2: index = p.Rm.value >> p.shift_imm; break;
					case 3: index = rotRight (p.Rm.value, p.shift_imm); break;
				}
			}
		}
		else
		{
			// immediate offset
			index = p.offset_12;
		}
		
		if (!p.U)
			index = -index;
		
		var address;
		if (p.P)
		{
			address = (p.Rn.value + index) >>> 0;
			if (p.W)
				p.Rn.value = address;
		}
		else
		{
			if (p.W)
				throw "possibly bad place";
			address = p.Rn.value;
			p.Rn.value = (p.Rn.value + index) >>> 0;
		}
		
		p.address = address >>> 0;
		return p;
	}
	
	function opcodesAddrMode3 (L)
	{
		L = L ? (1 << 20) : 0;
		
		return [
			// value, mask
			
			// immediate
			0x004000b0 | L, 0x0e5000f0, // S=0, H=1
			0x004000d0 | L, 0x0e5000f0, // S=1, H=0
			0x004000f0 | L, 0x0e5000f0, // S=1, H=1
			
			// register
			0x000000b0 | L, 0x0e500ff0, // S=0, H=1
			0x000000d0 | L, 0x0e500ff0, // S=1, H=0
			0x000000f0 | L, 0x0e500ff0, // S=1, H=1
		];
	}
	
	var predecodeAddrMode3 = makeInstructionPredecoder ({
		P: 24, U: 23, I: 22, W: 21, L: 20, S: 6, H: 5,
		Rn: [19, 16], Rd: [15, 12], Rm: [3, 0],
		immedH: [11, 8], immedL: [3, 0]
	});
	
	function decodeAddrMode3 (inst)
	{
		var p = predecodeAddrMode3.call (this, inst);
		
		var index;
		if (p.I)
		{
			// immediate offset
			index = (p.immedH << 4) | p.immedL;
		}
		else
		{
			// register offset
			index = p.Rm.value;
		}
		
		if (!p.U)
			index = -index;
		
		var address;
		if (p.P)
		{
			address = (p.Rn.value + index) >>> 0;
			if (p.W)
				p.Rn.value = address;
		}
		else
		{
			if (p.W)
				throw "unpredictable";
			address = p.Rn.value;
			p.Rn.value = (p.Rn.value + index) >>> 0;
		}
		
		p.address = address >>> 0;
		return p;
	}
	
	function opcodesAddrMode4 (L)
	{
		L = L ? (1 << 20) : 0;
		return [0x08000000 | L, 0x0e100000];
	}
	
	var predecodeAddrMode4 = makeInstructionPredecoder ({
		P: 24, U: 23, S: 22, W: 21, L: 20,
		Rn: [19, 16],
		register_list: [15, 0]
	});
	
	function decodeAddrMode4 (inst)
	{
		var p = predecodeAddrMode4.call (this, inst);
		var bc4 = bitCount (p.register_list) * 4;
		
		var start_address, end_address;
		if (p.U)
		{
			start_address = p.Rn.value;
			end_address = p.Rn.value + bc4 - 4;
			if (p.P)
			{
				start_address += 4;
				end_address += 4;
			}
			if (p.W)
				p.Rn.value += bc4;
		}
		else
		{
			start_address = p.Rn.value - bc4 + 4;
			end_address = p.Rn.value;
			if (p.P)
			{
				start_address -= 4;
				end_address -= 4;
			}
			if (p.W)
				p.Rn.value -= bc4;
		}
		
		p.start_address = start_address;
		p.end_address = end_address;
		return p;
	}
	
	var decodeCoprocessor = makeInstructionPredecoder ({
		Rd: [15, 12],
		CRm: [3, 0],
		CRn: [19, 16],
		cp_num: [11, 8],
		opcode_1: [23, 21],
		opcode_2: [7, 5],
	});
	
	doALU.STAT_NRM = function (a, b, r, cpsr, p) {
		cpsr.setC (p.shifter_carry_out);
		// V in unaffected
	};
	
	doALU.STAT_ADD = function (a, b, r, cpsr, p) {
		var a31 = !!(a >>> 31);
		var b31 = !!(b >>> 31);
		var r31 = !!(r >>> 31);
		cpsr.setC ((a31 && b31) || (a31 && !r31) || (b31 && !r31));
		cpsr.setV ((a31 == b31) && (a31 != r31));
	};
	
	doALU.STAT_SUB = function (a, b, r, cpsr, p) {
		var a31 = !!(a >>> 31);
		var b31 = !!(b >>> 31);
		var r31 = !!(r >>> 31);
		// FIXME: breaks with SBC
		cpsr.setC (a >= b);
		cpsr.setV ((a31 != b31) && (a31 != r31));
	};
	
	doALU.STAT_RSB = function (a, b, r, cpsr, b) {
		return doALU.STAT_SUB (b, a, r, cpsr, b);
	};
	
	function doALU (p, func, stat, write)
	{
		var a = p.Rn.value >>> 0;
		var b = p.shifter_operand >>> 0;
		var result = func (a, b) >>> 0;
		if (write)
			p.Rd.value = result;
		
		if (p.S && write && p.Rd.index == 15)
		{
			var spsr = this.getStatReg (1);
			if (spsr)
				this.cpsr.value = spsr.value;
			else
				throw "can't read from SPSR";
		}
		else if (p.S)
		{
			this.cpsr.setN (!!(result & (1 << 31)));
			this.cpsr.setZ (result == 0);
			stat (a, b, result, this.cpsr, p);
		}
	}
	
	function inst_BX (p)
	{
		var addr = p.Rm.value;
		if (addr & 0x01)
			throw "thumb not supported";
		this.pc.value = addr & 0xFFFFFFFC;
	}
	
	function inst_MRC (p)
	{
		if (!(p.cp_num == 15 && p.opcode_1 == 0))
			throw "MRC not fully implemented";
		
		var data;
		if (p.CRn == 0)
		{
			// ID register
			if (p.CRm != 0)
				throw "bad ID instruction";
			if (p.opcode_2 == 0)
				data = 0x41129200;
			else if (p.opcode_2 == 1)
				data = 0x01000000; // no cache
			else
				throw "unknown ID instruction"
		}
		else if (p.CRn == 1)
		{
			// control register
			if (p.opcode_2 == 0)
				data = this.creg.value;
			else
				throw "unknown control instruction";
		}
		else
		{
			console.log (p);
			throw "MRC not fully implemented";
		}
		
		if (p.Rd.index == 15)
		{
			var cpsr = this.cpsr;
			var mask = 0xF0000000;
			cpsr.value = (cpsr.value & ~mask) | (cpsr & mask);
		}
		else
		{
			p.Rd.value = data;
		}
	}

	function inst_MCR (p)
	{
		if (!(p.cp_num == 15 && p.opcode_1 == 0))
			throw "MCR not fully implemented";
		
		var data = p.Rd.value;
		if (p.CRn == 1)
		{
			// control register
			if (p.opcode_2 == 0)
				this.creg.value = data;
			else
				throw "unknown control instruction";
		}
		else if (p.CRn == 2)
		{
			// translation table base
			if (p.CRm != 0 || p.opcode_2 != 0)
				throw "bad table instruction";
			this.vmem.regTable = p.Rd.value;
		}
		else if (p.CRn == 3)
		{
			// domain access control
			if (p.CRm != 0 || p.opcode_2 != 0)
				throw "bad domain instruction";
			this.vmem.regDomains = p.Rd.value;
		}
		else if (p.CRn == 7)
		{
			// cache management
			if (p.CRm == 7 && p.opcode_2 == 0)
				console.log ("=== INVALIDATE UNIFIED CACHE");
			else if (p.CRm == 10 && p.opcode_2 == 4)
				console.log ("=== DATA SYNC BARRIER");
			else
				throw "unknown cache instruction";
		}
		else if (p.CRn == 8)
		{
			// TLB functions
			if (p.CRm == 7 && p.opcode_2 == 0)
				console.log ("=== INVALIDATE TLB");
			else
				throw "unknown TLB instruction";
		}
		else
		{
			console.log (p);
			throw "MCR not fully implemented";
		}
	}
	
	function inst_LDR (p)
	{
		var data = this.vmem.getU32 (p.address);
		if (!this.creg.getU ())
			data = rotRight (data, 8 * (p.address & 0x03));
		if (p.Rd.index == 15 && (data & 0x03) != 0)
			throw "unaligned PC";
		p.Rd.value = data;
	}
	
	function inst_STR (p)
	{
		this.vmem.putU32 (p.address, p.Rd.value);
	}
	
	function inst_LDRH (p)
	{
		if (!this.creg.getU () && (p.address & 0x01) != 0)
			throw "unaligned half read";
		p.Rd.value = this.vmem.getU16 (p.address);
	}
	
	function inst_STRH (p)
	{
		if (!this.creg.getU () && (p.address & 0x01) != 0)
			throw "unaligned half write";
		this.vmem.putU16 (p.address, p.Rd.value & 0xFFFF);
	}
	
	function inst_LDRB (p)
	{
		p.Rd.value = this.vmem.getU8 (p.address);
	}
	
	function inst_STRB (p)
	{
		this.vmem.putU8 (p.address, p.Rd.value & 0xFF);
	}
	
	function inst_LDM (p)
	{
		if (p.S)
			throw "S not supported";
		
		// LDM (1)
		var address = p.start_address;
		
		for (var i = 0; i <= 14; i++)
		{
			if (p.register_list & (1 << i))
			{
				this.getReg (i).value = this.vmem.getU32 (address);
				address += 4;
			}
		}
		
		if (p.register_list & (1 << 15))
		{
			this.pc.value = this.vmem.getU32 (address) & 0xFFFFFFFC;
			address += 4;
		}
		
		if (address - 4 != p.end_address)
			throw "offset";
	}
	
	function inst_STM (p)
	{
		if (p.S)
			throw "S not supported";
		
		// STM (1)
		var address = p.start_address;
		
		for (var i = 0; i <= 15; i++)
		{
			if (p.register_list & (1 << i))
			{
				this.vmem.putU32 (address, this.getReg (i).value);
				address += 4;
			}
		}

		if (address - 4 != p.end_address)
			throw "offset";
	}
	
	function inst_AND (p)
	{
		doALU.call (this, p, function (a, b) { return a & b }, doALU.STAT_NRM, true);
	}

	function inst_EOR (p)
	{
		doALU.call (this, p, function (a, b) { return a ^ b }, doALU.STAT_NRM, true);
	}

	function inst_SUB (p)
	{
		doALU.call (this, p, function (a, b) { return a - b; }, doALU.STAT_SUB, true);
	}

	function inst_RSB (p)
	{
		doALU.call (this, p, function (a, b) { return b - a; }, doALU.STAT_RSB, true);
	}
	
	function inst_ADD (p)	
	{
		doALU.call (this, p, function (a, b) { return a + b; }, doALU.STAT_ADD, true);
	}
	
	function inst_ADC (p)
	{
		var func;
		if (this.cpsr.getC ())
			func = function (a, b) { return a + b + 1; };
		else
			func = function (a, b) { return a + b; };
		doALU.call (this, p, func, doALU.STAT_ADD, true);
	}

	function inst_TST (p)
	{
		doALU.call (this, p, function (a, b) { return a & b; }, doALU.STAT_NRM, false);
	}
	
	function inst_TEQ (p)
	{
		doALU.call (this, p, function (a, b) { return a ^ b; }, doALU.STAT_NRM, false);
	}
	
	function inst_CMP (p)
	{
		doALU.call (this, p, function (a, b) { return a - b; }, doALU.STAT_SUB, false);
	}
	
	function inst_CMN (p)
	{
		doALU.call (this, p, function (a, b) { return a + b; }, doALU.STAT_ADD, false);
	}
	
	function inst_ORR (p)
	{
		doALU.call (this, p, function (a, b) { return a | b }, doALU.STAT_NRM, true);
	}
	
	function inst_MOV (p)
	{
		doALU.call (this, p, function (a, b) { return b; }, doALU.STAT_NRM, true);
	}
	
	function inst_BIC (p)
	{
		doALU.call (this, p, function (a, b) { return a & (~b) }, doALU.STAT_NRM, true);
	}

	function inst_MVN (p)
	{
		doALU.call (this, p, function (a, b) { return ~b; }, doALU.STAT_NRM, true);
	}
	
	function inst_MRS (p)
	{
		if (p.R)
		{
			var spsr = this.getStatReg (1);
			if (!spsr)
				throw "MRS for SPSR in non-SPSR mode";
			p.Rd.value = spsr.value;
		}
		else
		{
			p.Rd.value = this.cpsr.value;
		}
	}
	
	function inst_MSR (p)
	{
		var UnallocMask = 0x0FFFFF00;
		var UserMask    = 0xF0000000;
		var PrivMask    = 0x0000000F;
		var StateMask   = 0x00000020;
	
		var operand;
		if (p.I)
			operand = rotRight (p._8_bit_immediate, p.rotate_imm * 2);
		else
			operand = p.Rm.value;
		
		if (operand & UnallocMask)
			throw "attempted to set reserved bits";
		
		var byte_mask =
			((p.field_mask & (1 << 0)) ? 0x000000FF : 0) |
			((p.field_mask & (1 << 1)) ? 0x0000FF00 : 0) |
			((p.field_mask & (1 << 2)) ? 0x00FF0000 : 0) |
			((p.field_mask & (1 << 3)) ? 0xFF000000 : 0);
		
		var mask;
		if (p.R)
		{
			var spsr = this.getStatReg (1);
			if (!spsr)
				throw "no SPSR";
			mask = byte_mask & (UserMask | PrivMask | StateMask);
			spsr.value = (spsr.value & ~mask) | (operand & mask);
		}
		else
		{
			if (this.cpsr.isPrivileged ())
			{
				if (operand & StateMask)
					throw "bad state setting";
				else
					mask = byte_mask & (UserMask | PrivMask);
			}
			else
				mask = byte_mask & UserMask;
			
			var cpsr = this.cpsr;
			cpsr.value = (cpsr.value & ~mask) | (operand & mask);
		}
	}
	
	function inst_B_BL (p)
	{
		if (p.L)
			this.getReg (14).value = this.curpc + 4;
		this.pc.value += (p.signed_immed_24 << 8) >> 6;
	}
	
	var table = [
		[
			inst_BX,
			makeInstructionPredecoder ({Rm: [3, 0]}),
			[0x012fff10, 0x0ffffff0],
		],
		[
			inst_MRC,
			decodeCoprocessor,
			[0x0e100010, 0x0f100010],
		],
		[
			inst_MCR,
			decodeCoprocessor,
			[0x0e000010, 0x0f100010],
		],
		[
			inst_LDR,
			decodeAddrMode2,
			opcodesAddrMode2 (false, true),
		],
		[
			inst_STR,
			decodeAddrMode2,
			opcodesAddrMode2 (false, false),
		],
		[
			inst_LDRH,
			decodeAddrMode3,
			opcodesAddrMode3 (true),
		],
		[
			inst_STRH,
			decodeAddrMode3,
			opcodesAddrMode3 (false),
		],
		[
			inst_LDRB,
			decodeAddrMode2,
			opcodesAddrMode2 (true, true),
		],
		[
			inst_STRB,
			decodeAddrMode2,
			opcodesAddrMode2 (true, false),
		],
		[
			inst_LDM,
			decodeAddrMode4,
			opcodesAddrMode4 (true),
		],
		[
			inst_STM,
			decodeAddrMode4,
			opcodesAddrMode4 (false),
		],
		[
			inst_AND,
			decodeAddrMode1,
			opcodesAddrMode1 (0, false),
		],
		[
			inst_EOR,
			decodeAddrMode1,
			opcodesAddrMode1 (1, false),
		],
		[
			inst_SUB,
			decodeAddrMode1,
			opcodesAddrMode1 (2, false),
		],
		[
			inst_RSB,
			decodeAddrMode1,
			opcodesAddrMode1 (3, false),
		],
		[
			inst_ADD,
			decodeAddrMode1,
			opcodesAddrMode1 (4, false),
		],
		[
			inst_ADC,
			decodeAddrMode1,
			opcodesAddrMode1 (5, false),
		],
		[
			inst_TST,
			decodeAddrMode1,
			opcodesAddrMode1 (8, true),
		],
		[
			inst_TEQ,
			decodeAddrMode1,
			opcodesAddrMode1 (9, true),
		],
		[
			inst_CMP,
			decodeAddrMode1,
			opcodesAddrMode1 (10, true),
		],
		[
			inst_CMN,
			decodeAddrMode1,
			opcodesAddrMode1 (11, true),
		],
		[
			inst_ORR,
			decodeAddrMode1,
			opcodesAddrMode1 (12, false),
		],
		[
			inst_MOV,
			decodeAddrMode1,
			opcodesAddrMode1 (13, false),
		],
		[
			inst_BIC,
			decodeAddrMode1,
			opcodesAddrMode1 (14, false),
		],
		[
			inst_MVN,
			decodeAddrMode1,
			opcodesAddrMode1 (15, false),
		],
		[
			inst_MRS,
			makeInstructionPredecoder ({R: 22, Rd: [15, 12]}),
			[0x010f0000, 0x0fbf0fff]
		],
		[
			inst_MSR,
			makeInstructionPredecoder ({
				I: 25, R: 22,
				Rm: [3, 0],
				field_mask: [19, 16],
				rotate_imm: [11, 8],
				_8_bit_immediate: [7, 0],
			}),
			[
				0x0320f000, 0x0fb0f000,
				0x0120f000, 0x0fb0fff0,
			]
		],
		[
			inst_B_BL,
			makeInstructionPredecoder ({
				L: 24, signed_immed_24: [23, 0]
			}),
			[0x0a000000, 0x0e000000],
		]
	];

	function decode (inst)
	{
		var item;
		var match = false;
	
		for (var i = 0, ii = table.length; i < ii; i++)
		{
			var item = table[i];
			var opcodes = item[2];
			
			for (var j = 0, jj = opcodes.length; j < jj; j += 2)
			{
				var value = opcodes[j], mask = opcodes[j + 1];
				if ((inst & mask) == value)
				{
					match = true;
					break;
				}
			}
			
			if (match)
				break;
		}
		
		return (match ? item : null);
	}
	
	return {
		decode: decode
	};	
	
})();

if (typeof module === "object")
	module.exports = CPUInst;
