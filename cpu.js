var CPU = (function () {

	if (typeof require === "function")
		var Mem = require ('./mem.js');

	var
		MODE_usr = 0x10,
		MODE_fiq = 0x11,
		MODE_irq = 0x12,
		MODE_svc = 0x13,
		MODE_abt = 0x17,
		MODE_und = 0x1b,
		MODE_sys = 0x1f;
	
	function evaluateCondition (cond, cpsr)
	{
		if (cond == 0xF)
			throw "0b1111 condition not supported";
		
		var
			Z = cpsr.getZ (),
			C = cpsr.getC (),
			N = cpsr.getN (),
			V = cpsr.getV ();
		return [
			Z, !Z,
			C, !C,
			N, !N,
			V, !V,
			C && !Z,
			!C || Z,
			N == V,
			N != V,
			N == V && !Z,
			N != V || Z,
			true,
			false
		][cond];
	}
	
	function rotateLeft (val, sht)
	{
		return ((val << sht) | (val >>> (32 - sht))) >>> 0;
	}
	
	function rotateRight (val, sht)
	{
		return ((val >>> sht) | (val << (32 - sht))) >>> 0;
	}
	
	function decodeCommonShifter (inst, regs, cpsr)
	{
		var ret = {};
		ret.opcode = (inst >>> 21) & 0x0F;
		ret.S = !!(inst & (1 << 20));
		ret.Rn = regs[(inst >>> 16) & 0x0F];
		ret.Rd = regs[(inst >>> 12) & 0x0F];
		
		var Rm = regs[inst & 0x0F];
		var Rs = regs[(inst >>> 8) & 0x0F];
		var shift_imm = (inst >>> 7) & 0x1F;
		
		var shifter_operand;
		var shifter_carry_out;
		
		if ((inst & 0x0e000000) == 0x02000000)
		{
			var immed_8 = inst & 0xFF;
			var rotate_imm = (inst >>> 8) & 0x0F;
			shifter_operand = rotateRight (immed_8, rotate_imm * 2);
			shifter_carry_out = (rotate_imm == 0) ?
				cpsr.getC () : !!(shifter_operand & (1 << 31));
		}
		else if ((inst & 0x0e000000) == 0x00000000)
		{
			var r = inst & (1 << 4);
			var s = r ? (Rs.value & 0xFF) : (shift_imm);
			
			switch ((inst >>> 5) & 0x03)
			{
				case 0: // logical shift left
					if (s == 0)
					{
						shifter_operand = Rm.value;
						shifter_carry_out = cpsr.getC ();
					}
					else if (s < 32)
					{
						shifter_operand = Rm.value << s;
						shifter_carry_out = !!(Rm.value & (1 << (32 - s)));
					}
					else if (s == 32)
					{
						shifter_operand = 0;
						shifter_carry_out = !!(Rm.value & (1 << 0));
					}
					else if (s > 32)
					{
						shifter_operand = 0;
						shifter_carry_out = 0;
					}
					break;
				case 1: // logical shift right
					if (!r && s == 0)
						s = 32;
					if (s == 0)
					{
						shifter_operand = Rm.value;
						shifter_carry_out = cpsr.getC ();
					}
					else if (s < 32)
					{
						shifter_operand = Rm.value >>> s;
						shifter_carry_out = !!(Rm.value & (1 << (s - 1)));
					}
					else if (s == 32)
					{
						shifter_operand = 0;
						shifter_carry_out = !!(Rm.value & (1 << 31));
					}
					else if (s > 32)
					{
						shifter_operand = 0;
						shifter_carry_out = 0;
					}
					break;
				case 2: // arithmetic shift right
					if (!r && s == 0)
						s = 32;
					if (s == 0)
					{
						shifter_operand = Rm.value;
						shifter_carry_out = cpsr.getC ();
					}
					else if (s < 32)
					{
						shifter_operand = Rm.value >> s;
						shifter_carry_out = !!(Rm.value & (1 << (s - 1)));
					}
					else
					{
						shifter_carry_out = !!(Rm.value & (1 << 31));
						if (shifter_carry_out)
							shifter_operand = 0xFFFFFFFF;
						else
							shifter_operand = 0;
					}
					break;
				case 3: // rotate right
					if (!r && s == 0)
					{
						// rotate right with extend
						shifter_operand = (cpsr.getC () << 31) | (Rm.value >>> 1);
						shifter_carry_out = !!(Rm.value & (1 << 0));
					}
					else
					{
						// normal rotate right
						var ss = s & 0x1F;
						if (s == 0)
						{
							shifter_operand = Rm.value;
							shifter_carry_out = cpsr.getC ();
						}
						else if (ss == 0)
						{
							shifter_operand = Rm.value;
							shifter_carry_out = !!(Rm.value & (1 << 31));
						}
						else
						{
							shifter_operand = Rm.value >> ss;
							shifter_carry_out = !!(Rm.value & (1 << (ss - 1)));
						}
					}
					break;
			}
		}
		else
		{
			throw new Error ("bad shifter instruction");
		}
		
		ret.shifter_operand = ret.so = shifter_operand;
		ret.shifter_carry_out = ret.sco = shifter_carry_out;
		return ret;
	}
	
	function commonShifter (inst, regs, statregs, temp,
		func, Nfunc, Zfunc, Cfunc, Vfunc)
	{
		var s = decodeCommonShifter (inst, regs, statregs[0]);
		
		var a = s.Rn.value;
		var b = s.so;
		var r = func (a, b) >>> 0;
		if (!temp)
			s.Rd.value = r;
		
		var cpsr = statregs[0], spsr = statregs[1];
		
		if (s.S && s.Rd.index == 15 && !temp)
		{
			if (spsr)
				cpsr.value = spsr.value;
			else
				throw "attempted to set SPSR in non-SPSR mode";
		}
		else if (s.S)
		{
			var a31 = !!(a & (1 << 31));
			var b31 = !!(b & (1 << 31));
			var r31 = !!(r & (1 << 31));
			
			var args = [a, b, r, a31, b31, r31, s.sco];
			var f;
			
			(f = Nfunc.apply (null, args)) !== undefined && cpsr.setN (f);
			(f = Zfunc.apply (null, args)) !== undefined && cpsr.setZ (f);
			(f = Cfunc.apply (null, args)) !== undefined && cpsr.setC (f);
			(f = Vfunc.apply (null, args)) !== undefined && cpsr.setV (f);
		}
	}
	
	function preLoadStore (inst)
	{
		var ret = {}
		ret.P = !!(inst & (1 << 24));
		ret.U = !!(inst & (1 << 23));
		ret.S = !!(inst & (1 << 22));
		ret.W = !!(inst & (1 << 21));
		ret.L = !!(inst & (1 << 20));
		return ret;
	}
	
	function preLoadStoreSingle (inst, regs, statregs)
	{
		if ((inst & 0x0c000000) != 0x04000000)
			throw "bad load/store single instruction";
	
		var ret = preLoadStore (inst);
		var Rn = ret.Rn = regs[(inst >>> 16) & 0x0F];
		var Rd = ret.Rd = regs[(inst >>> 12) & 0x0F];
		
		var cpsr = statregs[0], spsr = statregs[1];
		var Rm = regs[inst & 0x0F];
		
		var index;
		if (inst & (1 << 25))
		{
			// (scaled) register offset
			var shift_imm = (inst >>> 7) & 0x1F;
			switch ((ret >>> 5) & 0x03)
			{
				case 0:
					index = Rm.value << shift_imm;
					break;
				case 1:
					if (shift_imm == 0)
						index = 0;
					else
						index = Rm.value >>> shift_imm;
					break;
				case 2:
					if (shift_imm == 0)
						index = (Rm & (1 << 31)) ? 0xFFFFFFFF : 0;
					else
						index = Rm.value >> shift_imm;
					break;
				case 3:
					if (shift_imm == 0)
						index = (cpsr.getC () << 31) | (Rm.value >>> 1);
					else
						index = rotateRight (Rm, shift_imm);
					break;
			}
		}
		else
		{
			// immediate offset
			index = inst & 0x0FFF;
		}
		
		if (!ret.U)
			index = -index;
		
		var address;
		if (ret.P && !ret.W)
		{
			address = Rn.value + index;
		}
		else if (ret.P && ret.W)
		{
			address = Rn.value + index;
			Rn.value = address;
		}
		else if (!ret.P && !ret.W)
		{
			address = Rn.value;
			Rn.value += index;
		}
		else
		{
			throw "bad load/store single index";
		}
		
		ret.address = address;
		return ret;
	}
	
	function preLoadStoreMultiple (inst, regs)
	{
		if ((inst & 0x0e000000) != 0x08000000)
			throw "bad load/store multiple instruction";
		
		var ret = preLoadStore (inst);
		var Rn = ret.Rn = regs[(inst >>> 16) & 0x0F];
		var rl = ret.register_list = inst & 0xFFFF;
		
		// TODO: use faster algorithm
		var bs = 0;
		for (var i = 0; i < 16; i++)
			if (rl & (1 << i))
				bs++;
		var bs4 = bs * 4;
		
		var start_address, end_address;
		
		switch ((inst >> 23) & 0x03)
		{
			case 0:
				start_address = Rn.value - bs4 + 4;
				end_address = Rn.value;
				if (ret.W)
					Rn.value -= bs4;
				break;
			case 1:
				start_address = Rn.value;
				end_address = Rn.value + bs4 - 4;
				if (ret.W)
					Rn.value += bs4;
				break;
			case 2:
				start_address = Rn.value - bs4;
				end_address = Rn.value - 4;
				if (ret.W)
					Rn.value -= bs4;
				break;
			case 3:
				start_address = Rn.value + 4;
				end_address = Rn.value + bs4;
				if (ret.W)
					Rn.value += bs4;
				break;
		}
		
		ret.start_address = start_address;
		ret.end_address = end_address;
		return ret;
	}
	
	function preLoadStoreMisc (inst, regs)
	{
		if ((inst & 0x0e400090) != 0x00400090)
			throw "bad load/store misc instruction";
			
		var ret = preLoadStore (inst);
		var Rn = ret.Rn = regs[(inst >>> 16) & 0x0F];
		var Rd = ret.Rd = regs[(inst >>> 12) & 0x0F];
		
		var index;
		if (ret.S)
		{
			var immedH = (inst >>> 8) & 0x0F;
			var immedL = inst & 0x0F;
			index = (immedH << 4) | immedL;
		}
		else
		{
			var Rm = regs[inst & 0x0F];
			index = Rm.value;
		}
		
		if (!(inst & (1 << 23)))
			index = -index;
		
		var address;
		if (ret.P && ret.S && !ret.W)
		{
			address = Rn.value + index;
		}
		else if (ret.P && ret.S && ret.W)
		{
			address = Rn.value + index;
			Rn.value = address;
		}
		else if (!ret.P && ret.S && !ret.W)
		{
			address = Rn.value;
			Rn.value += index;
		}
		else
		{
			throw "bad load/store misc index";
		}
		
		ret.address = address;
		return ret;
	}

	function decodeCoprocessor (inst, regs)
	{
		var ret = {};
		ret.opcode_1 = (inst >>> 21) & 0x07;
		ret.CRn = (inst >>> 16) & 0x0F;
		ret.Rd = regs[(inst >>> 12) & 0x0F];
		ret.cp_num = (inst >>> 8) & 0x0F;
		ret.opcode_2 = (inst >>> 5) & 0x07;
		ret.CRm = inst & 0x0F;
		return ret;
	}
	
	function Register (value)
	{
		this.value = value || 0;
	}
	
	var makeBitGetter = function (x) {
		return function () {
			return !!(this.value & (1 << x));
		};
	};
	
	var makeBitSetter = function (x) {
		var bit = (1 << x);
		var mask = ~bit;
		return function (state) {
			if (state)
				this.value |= bit;
			else
				this.value &= mask;
		};
	};
	
	var attachBits = function (obj, bitmap) {
		for (var name in bitmap)
		{
			if (bitmap.hasOwnProperty (name))
			{
				var bit = bitmap[name];
				obj["get" + name] = makeBitGetter (bit);
				obj["set" + name] = makeBitSetter (bit);
			}
		}
	};
	
	var srp = new Register (0);
	srp.getMode = function () { return this.value & 0x1f; };
	srp.setMode = function (mode) { return (this.value & ~0x1f) | (mode & 0x1f); };
	srp.isPrivileged = function () { return this.getMode () != MODE_usr; }
	attachBits (srp, {
		N: 31,
		Z: 30,
		C: 29,
		V: 28,
		I: 7,
		F: 6,
		T: 5
	});
	
	function StatusRegister () { Register.apply (this, arguments); }
	StatusRegister.prototype = srp;
	StatusRegister.prototype.constructor = StatusRegister;
	
	function ProgramCounter () { Register.apply (this, arguments); }
	ProgramCounter.prototype = new Register (0);
	ProgramCounter.prototype.constructor = ProgramCounter;
	Object.defineProperty (ProgramCounter.prototype, "value", {
		get: function () { return this._value + 4; },
		set: function (x) { this._value = x >>> 0; }
	});
	Object.defineProperty (ProgramCounter.prototype, "raw", {
		get: function () { return this._value; },
		set: function (x) { this._value = x >>> 0; }
	});
	
	function ControlRegister () { Register.apply (this.arguments); }
	ControlRegister.prototype.constructor = ControlRegister;
	attachBits (ControlRegister.prototype, {
		L2: 26, EE: 25, VE: 24, XP: 23,
		U:  22, FI: 21, L4: 15, RR: 14,
		V: 13, I: 12, Z: 11, F: 10,
		R:  9, S:  8, B:  7, L:  6,
		D:  5, P:  4, W:  3, C:  2,
		A:  1, M:  0
	});
	
	function ARM (pmem)
	{
		this.creg = new ControlRegister (0);
		
		var r0 = new Register (0);
		var r1 = new Register (0);
		var r2 = new Register (0);
		var r3 = new Register (0);
		var r4 = new Register (0);
		var r5 = new Register (0);
		var r6 = new Register (0);
		var r7 = new Register (0);
		var r8 = new Register (0);
		var r9 = new Register (0);
		var r10 = new Register (0);
		var r11 = new Register (0);
		var r12 = new Register (0);
		var r13 = new Register (0);
		var r14 = new Register (0);
		var pc = new ProgramCounter (0);
		this.pc = pc;
		this.curpc = 0;
		
		var r13_svc = new Register (0);
		var r14_svc = new Register (0);
		var r13_abt = new Register (0);
		var r14_abt = new Register (0);
		var r13_und = new Register (0);
		var r14_und = new Register (0);
		var r13_irq = new Register (0);
		var r14_irq = new Register (0);
		var r13_fiq = new Register (0);
		var r14_fiq = new Register (0);
		
		var r8_fiq = new Register (0);
		var r9_fiq = new Register (0);
		var r10_fiq = new Register (0);
		var r11_fiq = new Register (0);
		var r12_fiq = new Register (0);
		
		this.mregs = new Array (32);
		this.mregs[MODE_usr] = [r0, r1, r2, r3, r4, r5, r6, r7,
			r8, r9, r10, r11, r12, r13, r14, pc];
		this.mregs[MODE_sys] = [r0, r1, r2, r3, r4, r5, r6, r7,
			r8, r9, r10, r11, r12, r13, r14, pc];
		this.mregs[MODE_svc] = [r0, r1, r2, r3, r4, r5, r6, r7,
			r8, r9, r10, r11, r12, r13_svc, r14_svc, pc];
		this.mregs[MODE_abt] = [r0, r1, r2, r3, r4, r5, r6, r7,
			r8, r9, r10, r11, r12, r13_abt, r14_abt, pc];
		this.mregs[MODE_und] = [r0, r1, r2, r3, r4, r5, r6, r7,
			r8, r9, r10, r11, r12, r13_und, r14_und, pc];
		this.mregs[MODE_irq] = [r0, r1, r2, r3, r4, r5, r6, r7,
			r8, r9, r10, r11, r12, r13_irq, r14_irq, pc];
		this.mregs[MODE_fiq] = [r0, r1, r2, r3, r4, r5, r6, r7,
			r8_fiq, r9_fiq, r10_fiq, r11_fiq, r12_fiq, r13_fiq, r14_fiq, pc];
			
		this.mregs.forEach (function (ma) {
			ma.forEach (function (reg, n) {
				reg.index = n;
			});
		});
		
		var cpsr = this.cpsr = new StatusRegister (0xd3);
		this.mstatregs = new Array (32);
		this.mstatregs[MODE_usr] = [cpsr, null];
		this.mstatregs[MODE_sys] = [cpsr, null];
		this.mstatregs[MODE_svc] = [cpsr, new StatusRegister (0)];
		this.mstatregs[MODE_abt] = [cpsr, new StatusRegister (0)];
		this.mstatregs[MODE_und] = [cpsr, new StatusRegister (0)];
		this.mstatregs[MODE_irq] = [cpsr, new StatusRegister (0)];
		this.mstatregs[MODE_fiq] = [cpsr, new StatusRegister (0)];
		
		this.vmem = new Mem.VirtualMemory (pmem, this.cpsr, this.creg);
	}
	
	ARM.prototype = {
		setPC: function (pc) {
			this.pc.raw = pc;
		},
		getRegs: function () {
			return this.mregs[this.cpsr.getMode ()];
		},
		getReg: function (reg) {
			return this.getRegs()[reg];
		},
		getStatRegs: function () {
			return this.mstatregs[this.cpsr.getMode ()];
		},
		getStatReg: function (reg) {
			return this.getStatRegs()[reg];
		},
		tick: function () {
			var inst = this.vmem.getU32 (this.curpc = this.pc.raw);
			this.pc.raw += 4;
			
			var cond = (inst >>> 28) & 0xf;
			if (!evaluateCondition (cond, this.cpsr))
			{
				console.log ("skip " + (this.pc.raw - 4).toString (16));
				return;
			}
			else
				console.log ("eval " + (this.pc.raw - 4).toString (16));
			
			if ((inst & 0x0ff000f0) == 0x07500050)
				throw new Error ("undefined instruction!");
			else if (
				(inst & 0x0fb0f000) == 0x0320f000 ||
				(inst & 0x0fb0fff0) == 0x0120f000
			)
				this.inst_MSR (inst);
			else if ((inst & 0x0fbf0fff) == 0x010f0000)
				this.inst_MRS (inst);
			else if ((inst & 0x0c500000) == 0x04100000)
				this.inst_LDR (inst);
			else if ((inst & 0x0c500000) == 0x04000000)
				this.inst_STR (inst);
			else if ((inst & 0x0e5000f0) == 0x005000b0)
				this.inst_LDRH (inst);
			else if ((inst & 0x0e5000f0) == 0x004000b0)
				this.inst_STRH (inst);
			else if ((inst & 0x0c500000) == 0x04500000)
				this.inst_LDRB (inst);
			else if ((inst & 0x0c500000) == 0x04400000)
				this.inst_STRB (inst);
			else if ((inst & 0x0e500000) == 0x08100000)
				this.inst_LDM1 (inst);
			else if ((inst & 0x0e500000) == 0x08000000)
				this.inst_STM1 (inst);
			else if ((inst & 0x0f100010) == 0x0e100010)
				this.inst_MRC (inst);
			else if ((inst & 0x0f100010) == 0x0e000010)
				this.inst_MCR (inst);
			else if ((inst & 0x0e000000) == 0x0a000000)
				this.inst_B_BL (inst);
			else if ((inst & 0x0ffffff0) == 0x012fff10)
				this.inst_BX (inst);
			else if ((inst & 0x0de00000) == 0x01a00000)
				this.inst_MOV (inst);
			else if ((inst & 0x0de00000) == 0x01e00000)
				this.inst_MVN (inst);
			else if ((inst & 0x0de00000) == 0x00800000)
				this.inst_ADD (inst);
			else if ((inst & 0x0de00000) == 0x00a00000)
				this.inst_ADC (inst);
			else if ((inst & 0x0de00000) == 0x00400000)
				this.inst_SUB (inst);
			else if ((inst & 0x0de00000) == 0x00600000)
				this.inst_RSB (inst);
			else if ((inst & 0x0de00000) == 0x00000000)
				this.inst_AND (inst);
			else if ((inst & 0x0de00000) == 0x01800000)
				this.inst_ORR (inst);
			else if ((inst & 0x0de00000) == 0x01c00000)
				this.inst_BIC (inst);
			else if ((inst & 0x0df00000) == 0x01500000)
				this.inst_CMP (inst);
			else if ((inst & 0x0df00000) == 0x01700000)
				this.inst_CMN (inst);
			else if ((inst & 0x0df00000) == 0x01300000)
				this.inst_TEQ (inst);
			else if ((inst & 0x0df00000) == 0x01100000)
				this.inst_TST (inst);
			else
			{
				function hex32 (x)
				{
					x = x.toString (16);
					while (x.length < 8)
						x = "0" + x;
					return x;
				}
				console.log ("BAD INSTRUCTION: " + hex32 (inst) + " at " + hex32 (this.curpc));
				console.log (this.getRegs ());
				throw "BAD INSTRUCTION";
			}
		},
		inst_MSR : function (inst) {
		
			var R = !!(inst & (1 << 22));
			var field_mask = (inst >>> 16) & 0x0F;
			var rotate_imm = (inst >>> 8) & 0x0F;
			var eight_bit_immediate = inst & 0xFF;
			var Rm = this.getReg (inst & 0x0F);
			
			var operand;
			if (inst & (1 << 25))
				operand = rotateRight (eight_bit_immediate, rotate_imm * 2);
			else
				operand = Rm.value;
			
			if (operand & 0x0FFFFF00)
				throw 'attempted to set reserved PSR bits : ' + operand.toString (16);
			
			var byte_mask =
				((field_mask & 0x01) ? 0x000000FF : 0) |
				((field_mask & 0x02) ? 0x0000FF00 : 0) |
				((field_mask & 0x04) ? 0x00FF0000 : 0) |
				((field_mask & 0x08) ? 0xFF000000 : 0);
			
			var mask;
			if (!R)
			{
				if (this.cpsr.getMode () != MODE_usr) // if privileged
				{
					if (operand & 0x00000020)
						throw "attempted to set non-ARM execution state";
					else
						mask = byte_mask & 0xF000000F;
				}
				else
					mask = byte_mask & 0xF0000000;
				this.cpsr.value = (this.cpsr.value & ~mask) | (operand & mask);
			}
			else
			{
				var spsr = this.getStatReg (1);
				if (spsr)
				{
					mask = byte_mask & 0xF000002F;
					spsr.value = (spsr.value & ~mask) | (operand & mask);
				}
				else
					throw "attempted to set SPSR where SPSR doesn't exist";
			}
		},
		inst_MRS: function (inst) {
			var R = !!(inst & (1 << 22));
			var Rd = this.getReg ((inst >>> 12) & 0x0F);
			
			var cpsr = this.getStatReg (0), spsr = this.getStatReg (1);
			if (R)
			{
				if (spsr)
					Rd.value = spsr.value;
				else
					throw "no SPSR in current mode";
			}
			else
			{
				Rd.value = cpsr.value;
			}
		},
		inst_MRC: function (inst) {

			var c = decodeCoprocessor (inst, this.getRegs ());
			if (!(c.cp_num == 15 && c.opcode_1 == 0))
				throw "MCR not fully implemented";
			if (c.Rd.value == 15)
				throw "use of PC for coprocessor";
			
			if (c.CRn == 0 && c.opcode_2 == 0)
			{
				c.Rd.value = 0x41069200;
			}
			else if (c.CRn == 0 && c.opcode_2 == 1)
			{
				c.Rd.value = 0x01000000; // no cache
			}
			else if (c.CRn == 1 && c.opcode_2 == 0)
			{
				c.Rd.value = this.creg.value;
			}
			else
			{
				console.log (c);
				throw "MRC not fully implemented";
			}
		},
		inst_MCR: function (inst) {

			var c = decodeCoprocessor (inst, this.getRegs ());
			if (!(c.cp_num == 15 && c.opcode_1 == 0))
				throw "MCR not fully implemented";
			if (c.Rd.value == 15)
				throw "use of PC for coprocessor";
			
			switch (c.CRn)
			{
				case 1:
					if (c.opcode_2 == 0)
						this.creg.value = c.Rd.value;
					else
						throw "bad opcode";
					break;
				case 2:
					if (c.opcode_2 == 0)
						this.vmem.regTable = c.Rd.value;
					else
						throw "bad opcode";
					break;
				case 3:
					if (c.opcode_2 == 0)
						this.vmem.regDomains = c.Rd.value;
					else
						throw "bad opcode";
					break;
				case 7: // cache management
					break;
				case 8: // memory management
					break;
				default:
					throw "MCR not fully implemented";
			}
		},
		inst_B_BL: function (inst) {
			var L = !!(inst & (1 << 24))
			var signed_immed_24 = inst & 0x00FFFFFF;
			var si24 = signed_immed_24;
			
			if (L)
				this.getReg (14).value = this.curpc + 4;
			
			var se30 = si24 | ((si24 & (1 << 23)) ? 0xFF000000 : 0);
			this.pc.value += se30 << 2;
		},
		inst_BX: function (inst) {
			var Rm = this.getReg (inst & 0x0F);
			if (Rm.value & 0x01)
				throw "thumb not supported";
			this.pc.value = Rm.value & ~0x01;
		},
		inst_MOV: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), false,
				function (a, b)
					{ return b; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31, sco)
					{ return sco; },
				function (a, b, r, a31, b31, r31)
					{ return undefined; }
			);
		},
		inst_MVN: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), false,
				function (a, b)
					{ return ~b; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31, sco)
					{ return sco; },
				function (a, b, r, a31, b31, r31)
					{ return undefined; }
			);
		},
		inst_ADD: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), false,
				function (a, b)
					{ return a + b; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31)
					{ return (a >>> 0) + (b >>> 0) > 0xFFFFFFFF; },
				function (a, b, r, a31, b31, r31)
					{ return (a31 && b31 && !r31) || (!a31 && !b31 && r31); }
			);
		},
		inst_ADC: function (inst) {
			var c = Number (this.cpsr.getC ());
			commonShifter (inst, this.getRegs (), this.getStatRegs (), false,
				function (a, b)
					{ return a + b + c; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31)
					{ return (a >>> 0) + (b >>> 0) + c > 0xFFFFFFFF; },
				function (a, b, r, a31, b31, r31)
					{ return (a31 && b31 && !r31) || (!a31 && !b31 && r31); }
			);
		},
		inst_SUB: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), false,
				function (a, b)
					{ return a - b; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31)
					{ return (b >>> 0) <= (a >>> 0); },
				function (a, b, r, a31, b31, r31)
					{ return (!a31 && b31 && r31) || (a31 && !b31 && !r31); }
			);
		},
		inst_RSB: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), false,
				function (a, b)
					{ return b - a; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31)
					{ return (a >>> 0) <= (b >>> 0); },
				function (a, b, r, a31, b31, r31)
					{ return (!b31 && a31 && r31) || (b31 && !a31 && !r31); }
			);
		},
		inst_AND: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), false,
				function (a, b)
					{ return a & b; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31, sco)
					{ return sco; },
				function (a, b, r, a31, b31, r31)
					{ return undefined; }
			);
		},
		inst_ORR: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), false,
				function (a, b)
					{ return a | b; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31, sco)
					{ return sco; },
				function (a, b, r, a31, b31, r31)
					{ return undefined; }
			);
		},
		inst_BIC: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), false,
				function (a, b)
					{ return a & ~b; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31, sco)
					{ return sco; },
				function (a, b, r, a31, b31, r31)
					{ return undefined; }
			);
		},
		inst_CMP: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), true,
				function (a, b)
					{ return a - b; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31, sco)
					{ return (b >>> 0) <= (a >>> 0); },
				function (a, b, r, a31, b31, r31)
					{ return (!a31 && b31 && r31) || (a31 && !b31 && !r31); }
			);
		},
		inst_CMN: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), true,
				function (a, b)
					{ return a + b; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31)
					{ return (a >>> 0) + (b >>> 0) > 0xFFFFFFFF; },
				function (a, b, r, a31, b31, r31)
					{ return (a31 && b31 && !r31) || (!a31 && !b31 && r31); }
			);
		},
		inst_TEQ: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), true,
				function (a, b)
					{ return a ^ b; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31, sco)
					{ return sco; },
				function (a, b, r, a31, b31, r31)
					{ return undefined; }
			);
		},
		inst_TST: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), true,
				function (a, b)
					{ return a & b; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31, sco)
					{ return sco; },
				function (a, b, r, a31, b31, r31)
					{ return undefined; }
			);
		},
		inst_LDR: function (inst) {
			var s = preLoadStoreSingle (inst, this.getRegs (), this.getStatRegs ());
			
			var data = this.vmem.getU32 (s.address);
			if (!this.creg.getU ())
				data = rotateRight (data, 8 * (s.address & 0x03));
			
			if (s.Rd.index == 15)
				data &= 0xFFFFFFFC;
			s.Rd.value = data;
		},
		inst_STR: function (inst) {
			var s = preLoadStoreSingle (inst, this.getRegs (), this.getStatRegs ());
			this.vmem.putU32 (s.address, s.Rd.value);
		},
		inst_LDRH: function (inst) {
			var s = preLoadStoreMisc (inst, this.getRegs (), this.getStatRegs ());
			s.Rd.value = this.vmem.getU16 (s.address);
		},
		inst_STRH: function (inst) {
			var s = preLoadStoreMisc (inst, this.getRegs (), this.getStatRegs ());
			this.vmem.putU16 (s.address, s.Rd.value & 0xFFFF);
		},
		inst_LDRB: function (inst) {
			var s = preLoadStoreSingle (inst, this.getRegs (), this.getStatRegs ());
			s.Rd.value = this.vmem.getU8 (s.address);
		},
		inst_STRB: function (inst) {
			var s = preLoadStoreSingle (inst, this.getRegs (), this.getStatRegs ());
			this.vmem.putU8 (s.address, s.Rd.value & 0xFF);
		},
		inst_LDM1: function (inst) {
			var s = preLoadStoreMultiple (inst, this.getRegs ());
			
			var address = s.start_address;
			for (var i = 0; i <= 14; i++)
			{
				if (s.register_list & (1 << i))
				{
					this.getReg (i).value = this.vmem.getU32 (address);
					address += 4;
				}
			}
			
			if (s.register_list & (1 << 15))
			{
				this.pc.value = this.vmem.getU32 (address) & 0xFFFFFFFC;
				address += 4;
			}
			
			if (s.end_address != address - 4)
				throw "assertion failed";
		},
		inst_STM1: function (inst) {
			var s = preLoadStoreMultiple (inst, this.getRegs ());
			
			var address = s.start_address;
			for (var i = 0; i <= 15; i++)
			{
				if (s.register_list & (1 << i))
				{
					this.vmem.putU32 (address, this.getReg (i).value);
					address += 4;
				}
			}

			if (s.end_address != address - 4)
				throw "assertion failed";
		},
	};
	
	return {
		ARM: ARM,
		StatusRegister: StatusRegister
	};
	
})();

if (typeof module === "object")
	module.exports = CPU;
