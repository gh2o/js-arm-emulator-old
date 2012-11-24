var Util = (function () {

	var DEBUG = [10, "log"];
	var INFO = [20, "info"];
	var WARN = [30, "warn"];
	var ERROR = [40, "error"];
	
	var loglevel = 15;
	function _log (msglevel, args)
	{
		if (msglevel[0] < loglevel)
			return;
			
		args = Array.prototype.slice.call (args, 0);
		var sub = args.shift ();
		args.unshift (sub + ":\t");
		console[msglevel[1]].apply (console, args);
	}
	
	function debug () { _log (DEBUG, arguments); }
	function info () { _log (INFO, arguments); }
	function warn () { _log (WARN, arguments); }
	function error () { _log (ERROR, arguments); }

	function hex32 (x)
	{
		var r = x.toString (16);
		while (r.length < 8)
			r = "0" + r;
		return r;
	}
	
	return {
		hex32: hex32,
		debug: debug,
		info: info,
		warn: warn,
		error: error,
	};

})();

if (typeof module === "object")
	module.exports = Util;
