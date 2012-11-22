if (typeof require === "function")
{
	Mem = require ('./mem.js');
	CPUInst = require ('./cpuinst.js');
	Util = require ('./util.js');
}

var CPU = (function () {

	var
		MODE_usr = 0x10,
		MODE_fiq = 0x11,
		MODE_irq = 0x12,
		MODE_svc = 0x13,
		MODE_abt = 0x17,
		MODE_und = 0x1b,
		MODE_sys = 0x1f;
	
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
		set: function (x) {
			var ov = this._value - 4;
			var nv = this._value = x >>> 0;
//			if (ov)
//				console.log ("branch from " + Util.hex32 (ov) +
//					" to " + Util.hex32 (nv));
		}
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
		evaluateCondition: function (inst)
		{
			var cond = (inst >>> 28) & 0x0F;
			if (cond == 0x0F)
				throw "0b1111 condition not supported";
		
			var
				Z = this.cpsr.getZ (),
				C = this.cpsr.getC (),
				N = this.cpsr.getN (),
				V = this.cpsr.getV ();
			return [
				Z, !Z,
				C, !C,
				N, !N,
				V, !V,
				C && !Z,
				!C || Z,
				N == V,
				N != V,
				(N == V) && !Z,
				(N != V) || Z,
				true,
				false
			][cond];
		},
		tick: function () {
			var inst = this.vmem.getU32 (this.curpc = this.pc.raw);
			this.pc.raw += 4;
			
			if (!this.evaluateCondition (inst))
				return;
			
			var item = CPUInst.decode (inst);
			if (!item)
			{
				console.log ("BAD INSTRUCTION: " + Util.hex32 (inst) +
					" at " + Util.hex32 (this.curpc));
				console.log (this.getRegs ());
				throw "bad instruction";
			}
			
			var func = item[0];
			var dec = item[1];
			
			try {
				var arg = dec.call (this, inst);
				func.call (this, arg);
			} catch (e) {
				Util.error ("cpu", e);
				Util.error ("cpu", this.getRegs ());
				throw e;
			}
		},
	};
	
	return {
		ARM: ARM,
	};
	
})();

if (typeof module === "object")
	module.exports = CPU;
