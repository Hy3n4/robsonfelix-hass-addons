// OSC 52 support for ttyd's terminal.
//
// OSC 52 is how a program inside a terminal hands text to the clipboard of the
// machine you are sitting at. tmux and herdr both emit it when you copy, but
// ttyd 1.7.7 - the newest release - has no @xterm/addon-clipboard, so those
// copies are parsed and discarded and nothing reaches your computer.
//
// The build injects this file into ttyd's own page, where xterm.js exposes
// parser.registerOscHandler and ttyd exposes the terminal as window.term.
(function () {
  'use strict';

  var MAX_WAIT_MS = 30000;
  var POLL_MS = 100;

  function decodeBase64Utf8(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  // navigator.clipboard needs a secure context, which Home Assistant over plain
  // http on a LAN address is not. The textarea path still works there because
  // the copy follows the mouse-up that selected the text, so the document still
  // holds transient user activation.
  function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(function () {
        legacyCopy(text);
      });
      return;
    }
    legacyCopy(text);
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    try {
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      document.execCommand('copy');
    } catch (e) {
      /* nothing further to try */
    }
    document.body.removeChild(ta);
  }

  function handleOsc52(data) {
    // Payload is "<targets>;<base64>"; targets selects clipboard/primary/etc.
    var sep = data.indexOf(';');
    var payload = sep >= 0 ? data.slice(sep + 1) : data;

    // "?" is a read request. Answering it would let any process in the terminal
    // exfiltrate the clipboard, so treat it as handled and reply with nothing.
    if (payload === '?') {
      return true;
    }

    // An empty payload officially means "clear the clipboard". tmux sends one
    // for an empty selection, so honouring it would let a stray click throw
    // away whatever you had copied.
    if (payload === '') {
      return true;
    }

    try {
      writeClipboard(decodeBase64Utf8(payload));
    } catch (e) {
      /* malformed payload - drop it rather than break the parser */
    }
    return true;
  }

  var waited = 0;
  var timer = setInterval(function () {
    if (window.term && window.term.parser) {
      clearInterval(timer);
      window.term.parser.registerOscHandler(52, handleOsc52);
      return;
    }
    waited += POLL_MS;
    if (waited >= MAX_WAIT_MS) {
      clearInterval(timer);
    }
  }, POLL_MS);
})();
