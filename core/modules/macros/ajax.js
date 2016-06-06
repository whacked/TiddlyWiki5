/*\
title: $:/core/modules/macros/ajax.js
type: application/javascript
module-type: macro

Macro to enable simple ajax call

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Information about this macro
*/

exports.name = "ajax";

exports.params = [
	{name: "sender"},
	{name: "url"}
];

/*
Run the macro
*/
exports.run = function(url, sender) {
    var xmlhttp;
    if (window.XMLHttpRequest) {
        // code for IE7+, Firefox, Chrome, Opera, Safari
        xmlhttp = new XMLHttpRequest();
    } else {
        // code for IE6, IE5
        xmlhttp = new ActiveXObject("Microsoft.XMLHTTP");
    }
    xmlhttp.onreadystatechange = function() {
        if (xmlhttp.readyState == XMLHttpRequest.DONE ) {
           if(xmlhttp.status == 200){
               if(sender) {
                   var parent = sender.parentNode;
                   var div = document.createElement("div");
                   div.innerHTML = xmlhttp.responseText;
                   parent.insertBefore(div, sender);
                   parent.removeChild(sender);
               }
           }
           else if(xmlhttp.status == 400) {
              console.error('There was an error 400')
           }
           else {
               console.error('something else other than 200 was returned')
           }
        }
    };

    xmlhttp.open("GET", url, true);
    xmlhttp.send();

    return "";
};

})();
