var Peripheral = (function () {

	function DBGU (base)
	{
		this.start = base;
		this.end = base + 512 - 1;
		this.wbuf = [];
	}
	
	DBGU.prototype = {
		read: function (register) {
			if (register == 20)
				return 0x0202; // transmitter empty and ready
			else if (register == 64)
				return 0x09290782;
			else if (register == 68)
				return 0;
			else
				throw new Error (register);
		},
		write: function (register, data) {
			if (register == 28) // transmit data
				process.stdout.write (String.fromCharCode (data));
			else
				throw new Error (register);
		},
	};
	
	function PMC (base)
	{
		this.start = base;
		this.end = base + 256 - 1;
	}
	
	PMC.prototype = {
		read: function (register) {
			if (register == 40) // PLLA
				return 0;
			else if (register == 48) // master clock
				return 0x01;
			else if (register == 64 || register == 68 || register == 72 || register == 76) // programmable clocks
				return 0x01;
			else
				throw new Error (register);
		},
		write: function (register, data) {
			if (register == 0)
			{
				// system clock enable
				data &= ~0x04; // ignore USB clock
				if (data)
					throw "unknown data: " + data;
			}
			else if (register == 16)
			{
				// peripheral clock enable
			}
			else if (register == 44)
			{
				// PLLB
				if (data)
					throw "unknown data: " + data;
			}
			else
				throw new Error ([register, data]);
		},
	};
	
	function Canary ()
	{
		this.start = 0xF0000000;
		this.end   = 0xFFFFFFFF;
	}
	
	Canary.prototype = {
		read: function (register) {
			throw new Error ("attempted read from " +
				Util.hex32 (0xF0000000 + register));
		},
		write: function (register, data) {
			throw new Error ("attempted write " + Util.hex32 (data) + " to " +
				Util.hex32 (0xF0000000 + register));
		},
	};
	
	return {
		DBGU: DBGU,
		PMC: PMC,
		Canary: Canary,
	};
	
})();

if (typeof module === "object")
	module.exports = Peripheral;
