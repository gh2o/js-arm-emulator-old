var Struct = (function () {

	function NumberItem (type, bits, littleEndian)
	{
		type = type.toUpperCase ();
	
		this.type = type;
		this.littleEndian = littleEndian;
		
		this.ftype = {'U': 'Uint', 'I': 'Int', 'F': 'Float'}[type] + bits;
		this.size = bits / 8;
	}
	
	NumberItem.prototype = {
		get: function (dv, offset) {
			return dv["get" + this.ftype](offset, this.littleEndian);
		},
		put: function (dv, offset, value) {
			dv["set" + this.ftype](offset, value, this.littleEndian);
		},
	};
	
	function ArrayItem (subitem, length)
	{
		this.subitem = subitem;
		this.length = length;
		
		this.size = subitem.size * length;
	}
	
	ArrayItem.prototype = {
		get: function (dv, offset) {
			var ret = [];
			var si = this.subitem;
			for (var i = 0; i < this.length; i++)
				ret.push (si.get (dv, offset + si.size * i))
			return ret;
		},
		put: function (dv, offset, value) {
			var si = this.subitem;
			for (var i = 0; i < this.length; i++)
				si.put (dv, offset + si.size * i, value[i]);
		},
	};
	
	function StructItem (pairs)
	{
		this.pairs = pairs;
		
		var sz = 0;
		pairs.forEach (function (pair) {
			sz += pair[1].size;
		});
		
		this.size = sz;
	};
	
	StructItem.prototype = {
		get: function (dv, offset) {
			var ret = {};
			this.pairs.forEach (function (pair) {
				var name = pair[0], item = pair[1];
				ret[name] = item.get (dv, offset);
				offset += item.size;
			});
			return ret;
		},
		put: function (dv, offset, value) {
			this.pairs.forEach (function (pair) {
				var name = pair[0], item = pair[1];
				item.put (dv, offset, value[name]);
				offset += item.size;
			});
		}
	};
	
	function _createStruct (desc, littleEndian)
	{
		var pairs = desc.map (function (pair) {
		
			var name = pair[0], sub = pair[1], item;
			
			if (typeof sub === "string")
			{	
				var dis = sub.match (/^([UIFuif])(8|16|32)(x(\d+))?$/);
				if (dis === null)
					throw "Invalid description: " + sub;
				
				item = new NumberItem (dis[1], parseInt (dis[2]), littleEndian);
				if (dis[4])
					item = new ArrayItem (item, parseInt (dis[4]));
			}
			else
			{
				item = _createStruct (sub, littleEndian);
			}
			
			if (typeof pair[2] === "number")
				item = new ArrayItem (item, pair[2]);
			
			return [name, item];
		});
		
		return new StructItem (pairs);
	}
	
	function createStruct (desc, littleEndian)
	{
		littleEndian = littleEndian || false;
		
		var si = _createStruct (desc, littleEndian);
		si.unpack = function (dv, offset) { return this.get (dv, offset || 0); };
		si.pack = function (dv, offset, value) { return this.put (dv, offset || 0,
			value); };
		
		return si;
	}

	return {
		NumberItem: NumberItem,
		ArrayItem: ArrayItem,
		StructItem: StructItem,
		createStruct: createStruct
	};

})();

if (typeof module === "object")
	module.exports = Struct;
