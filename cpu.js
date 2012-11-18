var CPU = (function () {

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
		else if ((inst & 0x0e000070) == 0x00000000)
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
			throw "bad shifter instruction";
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
	
	function preLoadStoreMultiple (inst, regs)
	{
		if (inst & 0x0e000000 != 0x08000000)
			throw "bad load/store multiplee instruction";
		
		var ret = {}
		var P = ret.P = !!(inst & (1 << 24));
		var U = ret.U = !!(inst & (1 << 23));
		var S = ret.S = !!(inst & (1 << 22));
		var W = ret.W = !!(inst & (1 << 21));
		var L = ret.L = !!(inst & (1 << 20));
		var Rn = ret.Rn = regs[(inst >>> 16) & 0x0F];
		var rl = ret.register_list = inst & 0xFFFF;
		
		// TODO: use faster algorithm
		var bs = 0;
		for (var i = 0; i < 16; i++)
			if (rl & (1 << i))
				bs++;
		var bs4 = bs * 4;
		
		var start_address, end_address;
		
		switch ((inst >> 24) & 0x03)
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
	
	var srp = new Register (0);
	srp.getN = makeBitGetter (31);
	srp.setN = makeBitSetter (31);
	srp.getZ = makeBitGetter (30);
	srp.setZ = makeBitSetter (30);
	srp.getC = makeBitGetter (29);
	srp.setC = makeBitSetter (29);
	srp.getV = makeBitGetter (28);
	srp.setV = makeBitSetter (28);
	srp.getI = makeBitGetter (7);
	srp.setI = makeBitSetter (7);
	srp.getF = makeBitGetter (6);
	srp.setF = makeBitSetter (6);
	srp.getT = makeBitGetter (5);
	srp.setT = makeBitSetter (5);
	srp.getMode = function () { return this.value & 0x1f; };
	srp.setMode = function (mode) { return (this.value & ~0x1f) | (mode & 0x1f); };
	
	function StatusRegister () { Register.apply (this, arguments); }
	StatusRegister.prototype = srp;
	StatusRegister.prototype.constructor = StatusRegister;
	
	function ARM (pmem)
	{
		this.pmem = pmem;
		this.vmem = pmem; // FIXME
	
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
		var pc = new Register (0);
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
		
		var cpsr = this.cpsr = new StatusRegister (0x1d3);
		this.mstatregs = new Array (32);
		this.mstatregs[MODE_usr] = [cpsr, null];
		this.mstatregs[MODE_sys] = [cpsr, null];
		this.mstatregs[MODE_svc] = [cpsr, new StatusRegister (0)];
		this.mstatregs[MODE_abt] = [cpsr, new StatusRegister (0)];
		this.mstatregs[MODE_und] = [cpsr, new StatusRegister (0)];
		this.mstatregs[MODE_irq] = [cpsr, new StatusRegister (0)];
		this.mstatregs[MODE_fiq] = [cpsr, new StatusRegister (0)];
	}
	
	ARM.prototype = {
		setPC: function (pc) {
			this.pc.value = pc;
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
			var inst = this.vmem.getU32 (this.curpc = this.pc.value);
			console.log ("read " + this.curpc.toString (16));
			this.pc.value += 8;
			
			var cond = (inst >>> 28) & 0xf;
			if (!evaluateCondition (cond, this.cpsr))
				return;
			
			if (
				(inst & 0x0fb0f000) == 0x0320f000 ||
				(inst & 0x0fb0fff0) == 0x0120f000
			)
				this.inst_MSR (inst);
			else if ((inst & 0x0f100010) == 0x0e100010)
				this.inst_MRC (inst);
			else if ((inst & 0x0e000000) == 0x0a000000)
				this.inst_B_BL (inst);
			else if ((inst & 0x0de00000) == 0x01a00000)
				this.inst_MOV (inst);
			else if ((inst & 0x0de00000) == 0x00800000)
				this.inst_ADD (inst);
			else if ((inst & 0x0de00000) == 0x00400000)
				this.inst_SUB (inst);
			else if ((inst & 0x0de00000) == 0x00000000)
				this.inst_AND (inst);
			else if ((inst & 0x0df00000) == 0x01300000)
				this.inst_TEQ (inst);
			else if ((inst & 0x0e500000) == 0x08100000)
				this.inst_LDM1 (inst);
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
			
			this.pc.value -= 4;
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
				throw 'attempted to set reserved PSR bits';
			
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
		inst_MRC: function (inst) {
		
			var opcode_1 = (inst >>> 21) & 0x07;
			var CRn = (inst >>> 16) & 0x0F;
			var Rd = this.getReg ((inst >>> 12) & 0x0F);
			var cp_num = (inst >>> 8) & 0x0F;
			var opcode_2 = (inst >>> 5) & 0x07;
			var CRm = inst & 0x0F;
			
			if (
				cp_num == 15 && opcode_1 == 0 && opcode_2 == 0 &&
				CRm == 0 && CRn == 0 && Rd != 15
			)
				Rd.value = 0x41009200;
			else
				throw "MRC not fully implemented";
		},
		inst_B_BL: function (inst) {
			var L = !!(inst & (1 << 24))
			var signed_immed_24 = inst & 0x00FFFFFF;
			var si24 = signed_immed_24;
			
			if (L)
				this.getReg (14).value = this.curpc + 4;
			
			var se30 = si24 | ((si24 & (1 << 23)) ? 0xFF000000 : 0);
			this.pc.value += (se30 << 2) + 4;
			this.pc.value >>>= 0;
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
		inst_ADD: function (inst) {
			commonShifter (inst, this.getRegs (), this.getStatRegs (), false,
				function (a, b)
					{ return a + b; },
				function (a, b, r, a31, b31, r31)
					{ return r31; },
				function (a, b, r, a31, b31, r31)
					{ return r == 0; },
				function (a, b, r, a31, b31, r31)
					{ return (a31 && b31) || (a31 && !r31) || (b31 && !r31); },
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
					{ return (!a31 && b31) || (!a31 && r31) || (b31 && r31); },
				function (a, b, r, a31, b31, r31)
					{ return (!a31 && b31 && r31) || (a31 && !b31 && !r31); }
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
				this.pc.value = (this.vmem.getU32 (address) & 0xFFFFFFFC) + 4;
				address += 4;
			}
			
			if (s.end_address != address - 4)
				throw "assertion failed";
		}
	};
	
	return {
		ARM: ARM,
		StatusRegister: StatusRegister
	};
	
})();

if (typeof module === "object")
	module.exports = CPU;
