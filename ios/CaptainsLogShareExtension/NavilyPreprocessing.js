var ExtensionPreprocessingJS = new function () {
  this.run = function (arguments) {
    var heading = document.querySelector("h1");
    arguments.completionFunction({
      url: window.location.href,
      title: heading ? heading.innerText.trim() : document.title,
      text: document.body ? document.body.innerText.slice(0, 60000) : "",
    });
  };
};
