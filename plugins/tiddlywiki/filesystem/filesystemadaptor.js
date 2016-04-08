/*\
title: $:/plugins/tiddlywiki/filesystem/filesystemadaptor.js
type: application/javascript
module-type: syncadaptor

A sync adaptor module for synchronising with the local filesystem via node.js APIs

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

// Get a reference to the file system
var fs = $tw.node ? require("fs") : null,
	path = $tw.node ? require("path") : null,
	chokidar = $tw.node ? require("chokidar") : null;

	var ws = null;
	try {
		ws = $tw.node ? require("ws") : null;
	} catch(e) {
		console.warn("WebSocket could not be imported");
		console.warn(e.message);
	}

function FileSystemAdaptor(options) {
	var self = this;
	this.wiki = options.wiki;
	this.logger = new $tw.utils.Logger("FileSystem");
	// Create the <wiki>/tiddlers folder if it doesn't exist
	$tw.utils.createDirectory($tw.boot.wikiTiddlersPath);
	
	self.chokidar_ignore = null;
	chokidar.watch($tw.boot.wikiTiddlersPath, {ignored: /[\/\\]\./})
		.on("ready", function() {
			self.chokidar_ignore = {};
		})
		.on("all", function(event, filepath) {
			if(self.chokidar_ignore === null) {
				return;
			}
			var tiddler_title = path.basename(filepath, ".tid");
			
			if(tiddler_title.match(/^Draft_of_/)) {
				return; // skip drafts
			} else if(!filepath.match(/\.tid$/)) {
				return; // skip any non-tid file
			} else if(self.chokidar_ignore[filepath]) {
				return; // handled within normal save cycle
			}
			
			$tw.wiki.addTiddlers(new_tiddlers);
			var new_tiddlers = $tw.loadTiddlersFromFile(filepath).tiddlers;
      
			// notify browser update
			self.notify_browser_update_tiddler(new_tiddlers[0].title);
		});

		self.ws_socket = null;
		if(ws) {
			console.log("starting WebSocket server...");
			self.ws_server = new ws.Server({port: 8081});
			self.ws_server.on("connection", function(ws) {
				console.log("WebSocket connected.");
				self.ws_socket = ws;
			});
		}
		self.notify_browser_update_tiddler = function(tiddler_title) {
			if(self.ws_socket) {
				self.ws_socket.send(JSON.stringify({message: "update_tiddler", title: tiddler_title}));
			}
		};

}

FileSystemAdaptor.prototype.getTiddlerInfo = function(tiddler) {
	return {};
};

$tw.config.typeInfo = {
	"text/vnd.tiddlywiki": {
		fileType: "application/x-tiddler",
		extension: ".tid"
	},
	"image/jpeg" : {
		hasMetaFile: true
	}
};

$tw.config.typeTemplates = {
	"application/x-tiddler": "$:/core/templates/tid-tiddler"
};

FileSystemAdaptor.prototype.getTiddlerFileInfo = function(tiddler,callback) {
	// See if we've already got information about this file
	var self = this,
		title = tiddler.fields.title,
		fileInfo = $tw.boot.files[title];
	// Get information about how to save tiddlers of this type
	var type = tiddler.fields.type || "text/vnd.tiddlywiki",
		typeInfo = $tw.config.typeInfo[type];
	if(!typeInfo) {
		typeInfo = $tw.config.typeInfo["text/vnd.tiddlywiki"];
	}
	var extension = typeInfo.extension || "";
	if(!fileInfo) {
		// If not, we'll need to generate it
		// Start by getting a list of the existing files in the directory
		fs.readdir($tw.boot.wikiTiddlersPath,function(err,files) {
			if(err) {
				return callback(err);
			}
			// Assemble the new fileInfo
			fileInfo = {};
			fileInfo.filepath = $tw.boot.wikiTiddlersPath + path.sep + self.generateTiddlerFilename(title,extension,files);
			fileInfo.type = typeInfo.fileType || tiddler.fields.type;
			fileInfo.hasMetaFile = typeInfo.hasMetaFile;
			// Save the newly created fileInfo
			$tw.boot.files[title] = fileInfo;
			// Pass it to the callback
			callback(null,fileInfo);
		});
	} else {
		// Otherwise just invoke the callback
		callback(null,fileInfo);
	}
};

/*
Transliterate string from cyrillic russian to latin
*/
 var transliterate = function(cyrillyc) {
	var a = {"Ё":"YO","Й":"I","Ц":"TS","У":"U","К":"K","Е":"E","Н":"N","Г":"G","Ш":"SH","Щ":"SCH","З":"Z","Х":"H","Ъ":"'","ё":"yo","й":"i","ц":"ts","у":"u","к":"k","е":"e","н":"n","г":"g","ш":"sh","щ":"sch","з":"z","х":"h","ъ":"'","Ф":"F","Ы":"I","В":"V","А":"a","П":"P","Р":"R","О":"O","Л":"L","Д":"D","Ж":"ZH","Э":"E","ф":"f","ы":"i","в":"v","а":"a","п":"p","р":"r","о":"o","л":"l","д":"d","ж":"zh","э":"e","Я":"Ya","Ч":"CH","С":"S","М":"M","И":"I","Т":"T","Ь":"'","Б":"B","Ю":"YU","я":"ya","ч":"ch","с":"s","м":"m","и":"i","т":"t","ь":"'","б":"b","ю":"yu"};
	return cyrillyc.split("").map(function (char) {
		return a[char] || char;
	}).join("");
};

/*
Given a tiddler title and an array of existing filenames, generate a new legal filename for the title, case insensitively avoiding the array of existing filenames
*/
FileSystemAdaptor.prototype.generateTiddlerFilename = function(title,extension,existingFilenames) {
	// First remove any of the characters that are illegal in Windows filenames
	var baseFilename = transliterate(title.replace(/<|>|\:|\"|\/|\\|\||\?|\*|\^|\s/g,"_"));
	// Truncate the filename if it is too long
	if(baseFilename.length > 200) {
		baseFilename = baseFilename.substr(0,200);
	}
	// Start with the base filename plus the extension
	var filename = baseFilename + extension,
		count = 1;
	// Add a discriminator if we're clashing with an existing filename while
	// handling case-insensitive filesystems (NTFS, FAT/FAT32, etc.)
	while(existingFilenames.some(function(value) {return value.toLocaleLowerCase() === filename.toLocaleLowerCase();})) {
		filename = baseFilename + " " + (count++) + extension;
	}
	return filename;
};

/*
Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
*/
FileSystemAdaptor.prototype.saveTiddler = function(tiddler,callback) {
	var self = this;
	this.getTiddlerFileInfo(tiddler,function(err,fileInfo) {
		var template, content, encoding,
			_finish = function() {
				callback(null, {}, 0);
        
				delete self.chokidar_ignore[fileInfo.filepath];
			};
		if(err) {
			return callback(err);
		}
    
		self.chokidar_ignore[fileInfo.filepath] = tiddler.fields.title;
    
		var typeInfo = $tw.config.contentTypeInfo[fileInfo.type];
		if(fileInfo.hasMetaFile || typeInfo.encoding === "base64") {
			// Save the tiddler as a separate body and meta file
			fs.writeFile(fileInfo.filepath,tiddler.fields.text,{encoding: typeInfo.encoding},function(err) {
				if(err) {
					return callback(err);
				}
				content = self.wiki.renderTiddler("text/plain","$:/core/templates/tiddler-metadata",{variables: {currentTiddler: tiddler.fields.title}});
				fs.writeFile(fileInfo.filepath + ".meta",content,{encoding: "utf8"},function (err) {
					if(err) {
						return callback(err);
					}
					self.logger.log("Saved file",fileInfo.filepath);
					_finish();
				});
			});
		} else {
			// Save the tiddler as a self contained templated file
			template = $tw.config.typeTemplates[fileInfo.type];
			content = self.wiki.renderTiddler("text/plain",template,{variables: {currentTiddler: tiddler.fields.title}});
			fs.writeFile(fileInfo.filepath,content,{encoding: "utf8"},function (err) {
				if(err) {
					return callback(err);
				}
				self.logger.log("Saved file",fileInfo.filepath);
				_finish();
			});
		}
	});
};

/*
Load a tiddler and invoke the callback with (err,tiddlerFields)

We don't need to implement loading for the file system adaptor, because all the tiddler files will have been loaded during the boot process.
*/
FileSystemAdaptor.prototype.loadTiddler = function(title,callback) {
	callback(null,null);
};

/*
Delete a tiddler and invoke the callback with (err)
*/
FileSystemAdaptor.prototype.deleteTiddler = function(title,callback,options) {
	var self = this,
		fileInfo = $tw.boot.files[title];
	// Only delete the tiddler if we have writable information for the file
	if(fileInfo) {
		// Delete the file
		fs.unlink(fileInfo.filepath,function(err) {
			if(err) {
				return callback(err);
			}
			self.logger.log("Deleted file",fileInfo.filepath);
			// Delete the metafile if present
			if(fileInfo.hasMetaFile) {
				fs.unlink(fileInfo.filepath + ".meta",function(err) {
					if(err) {
						return callback(err);
					}
					callback(null);
				});
			} else {
				callback(null);
			}
		});
	} else {
		callback(null);
	}
};

if(fs) {
	exports.adaptorClass = FileSystemAdaptor;
}

})();
