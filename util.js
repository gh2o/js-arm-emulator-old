var Util = (function () {

	function hex32 (x)
	{
		var r = x.toString (16);
		while (r.length < 8)
			r = "0" + r;
		return r;
	}
	
	return {
		hex32: hex32
	};

})();

if (typeof module === "object")
	module.exports = Util;
