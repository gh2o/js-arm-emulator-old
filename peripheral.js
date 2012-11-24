var Peripheral = (function () {

	var millis = null;
	if (typeof performance !== "undefined")
	{
		if (performance.now)
			millis = function () { return performance.now (); }
		else if (performance.webkitNow)
			millis = function () { return performance.webkitNow (); }
	}
	if (!millis)
		millis = function () { return Date.now (); }

	function Canary (start, end)
	{
		this.start = start;
		this.end   = end - 1;
	}
	
	Canary.prototype = {
		read: function (register) {
			throw new Error ("attempted read from " +
				Util.hex32 (this.start + register));
		},
		write: function (register, data) {
			throw new Error ("attempted write " + Util.hex32 (data) + " to " +
				Util.hex32 (this.start + register));
		},
	};
	
	function UART (base)
	{
		this.start = base;
		this.end = base + 4096 - 1;
	}
	
	UART.prototype = {
		read: function (register) {
			if (register == 24)
				return 0x40; // transmit empty
			else
				throw new Error (register);
		},
		write: function (register, data) {
			if (register == 0)
				process.stdout.write (String.fromCharCode (data));
			else
				throw new Error ([register, data]);
		}
	};
	
	function System ()
	{
		this.start = 0x10000000;
		this.end = 0x10000FFF;
	}
	
	System.prototype = {
		read: function (register) {
			if (register == 0x5c)
				return (millis () * 2400) >>> 0;
			else
				throw "system read " + register;
		},
		write: function (register, data) {
			throw "system write " + register + " " + data;
		},
	};
	
	return {
		Canary: Canary,
		System: System,
		UART: UART,
	};
	
})();

if (typeof module === "object")
	module.exports = Peripheral;
