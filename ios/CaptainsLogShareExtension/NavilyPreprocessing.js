/* eslint-env browser */
/* exported ExtensionPreprocessingJS */
var ExtensionPreprocessingJS = new function () {
  this.run = function (extensionArguments) {
    var heading = document.querySelector("h1");
    extensionArguments.completionFunction({
      url: window.location.href,
      title: heading ? heading.innerText.trim() : document.title,
      text: document.body ? document.body.innerText.slice(0, 60000) : "",
    });
  };
};
