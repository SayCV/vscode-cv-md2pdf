// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as url from 'url';
import * as os from 'os';

import { extensionName } from "./defaults";
import { log } from "./log";

let INSTALL_CHECK = false;

export function activate(context: vscode.ExtensionContext) {
  init();

  let commands = [
    vscode.commands.registerCommand('cv-md2pdf.settings', async function () { await md2pdf('settings'); }),
    vscode.commands.registerCommand('cv-md2pdf.pdf', async function () { await md2pdf('pdf'); }),
    vscode.commands.registerCommand('cv-md2pdf.html', async function () { await md2pdf('html'); }),
    vscode.commands.registerCommand('cv-md2pdf.png', async function () { await md2pdf('png'); }),
    vscode.commands.registerCommand('cv-md2pdf.jpeg', async function () { await md2pdf('jpeg'); }),
    vscode.commands.registerCommand('cv-md2pdf.all', async function () { await md2pdf('all'); })
  ];
  commands.forEach(function (command) {
    context.subscriptions.push(command);
  });

  let isConvertOnSave = vscode.workspace.getConfiguration('markdown-pdf')['convertOnSave'];
  if (isConvertOnSave) {
    let disposable_onsave = vscode.workspace.onDidSaveTextDocument(function () { md2pdfOnSave(); });
    context.subscriptions.push(disposable_onsave);
  }

  log.info(`${extensionName} extension has been activated.`);
}

// this method is called when your extension is deactivated
export function deactivate() {
  log.dispose();
}

async function md2pdf(option_type: string) {

  try {

    // check active window
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active Editor!');
      return;
    }

    // check markdown mode
    let mode = editor.document.languageId;
    if (mode != 'markdown') {
      vscode.window.showWarningMessage('It is not a markdown mode!');
      return;
    }

    var uri = editor.document.uri;
    var mdfilename = uri.fsPath;
    var ext = path.extname(mdfilename);
    if (!isExistsPath(mdfilename)) {
      if (editor.document.isUntitled) {
        vscode.window.showWarningMessage('Please save the file!');
        return;
      }
      vscode.window.showWarningMessage('File name does not get!');
      return;
    }

    var types_format = ['html', 'pdf', 'png', 'jpeg'];
    var filename = '';
    var types = [];
    if (types_format.indexOf(option_type) >= 0) {
      types[0] = option_type;
    } else if (option_type === 'settings') {
      var types_tmp = vscode.workspace.getConfiguration('markdown-pdf')['type'] || 'pdf';
      if (types_tmp && !Array.isArray(types_tmp)) {
        types[0] = types_tmp;
      } else {
        types = vscode.workspace.getConfiguration('markdown-pdf')['type'] || 'pdf';
      }
    } else if (option_type === 'all') {
      types = types_format;
    } else {
      showErrorMessage('md2pdf().1 Supported formats: html, pdf, png, jpeg.');
      return;
    }

    // convert and export markdown to pdf, html, png, jpeg
    if (types && Array.isArray(types) && types.length > 0) {
      for (var i = 0; i < types.length; i++) {
        var type = types[i];
        if (types_format.indexOf(type) >= 0) {
          filename = mdfilename.replace(ext, '.' + type);
          var text = editor.document.getText();
          var content = convertMarkdownToHtml(mdfilename, type, text);
          var html = makeHtml(content, uri);
          await exportPdf(html, filename, type, uri);
        } else {
          showErrorMessage('md2pdf().2 Supported formats: html, pdf, png, jpeg.');
          return;
        }
      }
    } else {
      showErrorMessage('md2pdf().3 Supported formats: html, pdf, png, jpeg.');
      return;
    }
  } catch (error) {
    showErrorMessage('md2pdf()', error);
  }
}

function md2pdfOnSave() {
  try {
    var editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    var mode = editor.document.languageId;
    if (mode != 'markdown') {
      return;
    }
    if (!ismd2pdfOnSaveExclude()) {
      md2pdf('settings');
    }
  } catch (error) {
    showErrorMessage('md2pdfOnSave()', error);
  }
}

function ismd2pdfOnSaveExclude() {
  try {
    var editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    var filename = path.basename(editor.document.fileName);
    var patterns = vscode.workspace.getConfiguration('markdown-pdf')['convertOnSaveExclude'] || '';
    var pattern;
    var i;
    if (patterns && Array.isArray(patterns) && patterns.length > 0) {
      for (i = 0; i < patterns.length; i++) {
        pattern = patterns[i];
        var re = new RegExp(pattern);
        if (re.test(filename)) {
          return true;
        }
      }
    }
    return false;
  } catch (error) {
    showErrorMessage('ismd2pdfOnSaveExclude()', error);
  }
}

/*
 * convert markdown to html (markdown-it)
 */
function convertMarkdownToHtml(filename: string, type: string, text: string) {
  var grayMatter = require("gray-matter");
  var matterParts = grayMatter(text);

  var statusbarmessage = vscode.window.setStatusBarMessage('$(markdown) Converting (convertMarkdownToHtml) ...');

  try {
    try {

      var hljs = require('highlight.js');
      var breaks = setBooleanValue(matterParts.data.breaks, vscode.workspace.getConfiguration('markdown-pdf')['breaks']);
      var md = require('markdown-it')({
        html: true,
        breaks: breaks,
        highlight: function (str: string, lang: string) {

          if (lang && lang.match(/\bmermaid\b/i)) {
            return `<div class="mermaid">${str}</div>`;
          }

          if (lang && hljs.getLanguage(lang)) {
            try {
              str = hljs.highlight(lang, str, true).value;
            } catch (error) {
              str = md.utils.escapeHtml(str);

              showErrorMessage('markdown-it:highlight', error);
            }
          } else {
            str = md.utils.escapeHtml(str);
          }
          return '<pre class="hljs"><code><div>' + str + '</div></code></pre>';
        }
      });
    } catch (error) {
      statusbarmessage.dispose();
      showErrorMessage('require(\'markdown-it\')', error);
    }

    // convert the img src of the markdown
    var cheerio = require('cheerio');
    var defaultRender = md.renderer.rules.image;
    md.renderer.rules.image = function (tokens: { [x: string]: any; }, idx: string | number, options: any, env: any, self: any) {
      var token = tokens[idx];
      var href = token.attrs[token.attrIndex('src')][1];
      // console.log("original href: " + href);
      if (type === 'html') {
        href = decodeURIComponent(href).replace(/("|')/g, '');
      } else {
        href = convertImgPath(href, filename);
      }
      // console.log("converted href: " + href);
      token.attrs[token.attrIndex('src')][1] = href;
      // // pass token to default renderer.
      return defaultRender(tokens, idx, options, env, self);
    };

    if (type !== 'html') {
      // convert the img src of the html
      md.renderer.rules.html_block = function (tokens: { [x: string]: { content: any; }; }, idx: string | number) {
        var html = tokens[idx].content;
        var $ = cheerio.load(html);
        $('img').each(() => {
          var src = $(this).attr('src');
          var href = convertImgPath(src, filename);
          $(this).attr('src', href);
        });
        return $.html();
      };
    }

    // checkbox
    md.use(require('markdown-it-checkbox'));

    // emoji
    var emojiEnable = setBooleanValue(matterParts.data.emoji, vscode.workspace.getConfiguration('markdown-pdf')['emoji']);
    if (emojiEnable) {
      var emojisDefs: any = require(path.join(__dirname, '..', 'data', 'emoji.json'));
      let options;
      try {
        options = {
          defs: emojisDefs
        };
      } catch (error) {
        statusbarmessage.dispose();
        showErrorMessage('markdown-it-emoji:options', error);
      }
      md.use(require('markdown-it-emoji'), options);
      md.renderer.rules.emoji = function (token: { [x: string]: { markup: any; }; }, idx: string | number) {
        var emoji = token[idx].markup;
        var emojipath = path.join(__dirname, '..', 'node_modules', 'emoji-images', 'pngs', emoji + '.png');
        var emojidata = Buffer.from(readFile(emojipath, '')).toString('base64');
        if (emojidata) {
          return '<img class="emoji" alt="' + emoji + '" src="data:image/png;base64,' + emojidata + '" />';
        } else {
          return ':' + emoji + ':';
        }
      };
    }

    // toc
    // https://github.com/leff/markdown-it-named-headers
    let options = {
      slugify: Slug
    }
    md.use(require('markdown-it-named-headers'), options);

    // markdown-it-container
    // https://github.com/markdown-it/markdown-it-container
    md.use(require('markdown-it-container'), '', {
      validate: function (name: { trim: () => { (): any; new(): any; length: any; }; }) {
        return name.trim().length;
      },
      render: function (tokens: { [x: string]: { info: string; }; }, idx: string | number) {
        if (tokens[idx].info.trim() !== '') {
          return `<div class="${tokens[idx].info.trim()}">\n`;
        } else {
          return `</div>\n`;
        }
      }
    });

    // PlantUML
    // https://github.com/gmunguia/markdown-it-plantuml
    var plantumlOptions = {
      openMarker: matterParts.data.plantumlOpenMarker || vscode.workspace.getConfiguration('markdown-pdf')['plantumlOpenMarker'] || '@startuml',
      closeMarker: matterParts.data.plantumlCloseMarker || vscode.workspace.getConfiguration('markdown-pdf')['plantumlCloseMarker'] || '@enduml',
      server: vscode.workspace.getConfiguration('markdown-pdf')['plantumlServer'] || ''
    }
    md.use(require('markdown-it-plantuml'), plantumlOptions);

    // markdown-it-include
    // https://github.com/camelaissani/markdown-it-include
    // the syntax is :[alt-text](relative-path-to-file.md)
    // https://talk.commonmark.org/t/transclusion-or-including-sub-documents-for-reuse/270/13
    if (vscode.workspace.getConfiguration('markdown-pdf')['markdown-it-include']['enable']) {
      md.use(require("markdown-it-include"), {
        root: path.dirname(filename),
        includeRe: /:\[.+\]\((.+\..+)\)/i
      });
    }

    statusbarmessage.dispose();
    return md.render(matterParts.content);

  } catch (error) {
    statusbarmessage.dispose();
    showErrorMessage('convertMarkdownToHtml()', error);
  }
}

/*
 * https://github.com/microsoft/vscode/blob/ca4ceeb87d4ff935c52a7af0671ed9779657e7bd/extensions/markdown-language-features/src/slugify.ts#L26
 */
function Slug(string: string) {
  try {
    var stg = encodeURI(
      string.trim()
        .toLowerCase()
        .replace(/\s+/g, '-') // Replace whitespace with -
        .replace(/[\]\[\!\'\#\$\%\&\(\)\*\+\,\.\/\:\;\<\=\>\?\@\\\^\_\{\|\}\~\`。，、；：？！…—·ˉ¨‘’“”々～‖∶＂＇｀｜〃〔〕〈〉《》「」『』．〖〗【】（）［］｛｝]/g, '') // Remove known punctuators
        .replace(/^\-+/, '') // Remove leading -
        .replace(/\-+$/, '') // Remove trailing -
    );
    return stg;
  } catch (error) {
    showErrorMessage('Slug()', error);
  }
}

/*
 * make html
 */
function makeHtml(data: any, uri: vscode.Uri) {
  try {
    // read styles
    var style = '';
    style += readStyles(uri);

    // get title
    var title = path.basename(uri.fsPath);

    // read template
    var filename = path.join(__dirname, '..', 'template', 'template.html');
    var template = readFile(filename);

    // read mermaid javascripts
    var mermaidServer = vscode.workspace.getConfiguration('markdown-pdf')['mermaidServer'] || '';
    var mermaid = '<script src=\"' + mermaidServer + '\"></script>';

    // compile template
    var mustache = require('mustache');

    var view = {
      title: title,
      style: style,
      content: data,
      mermaid: mermaid
    };
    return mustache.render(template, view);
  } catch (error) {
    showErrorMessage('makeHtml()', error);
  }
}

/*
 * export a html to a html file
 */
function exportHtml(data: string, filename: fs.PathOrFileDescriptor) {
  fs.writeFile(filename, data, 'utf-8', function (error) {
    if (error) {
      showErrorMessage('exportHtml()', error);
      return;
    }
  });
}

/*
 * export a html to a pdf file (html-pdf)
 */
function exportPdf(data: any, filename: string, type: string, uri: vscode.Uri | undefined) {

  if (!INSTALL_CHECK) {
    return;
  }
  if (!checkPuppeteerBinary()) {
    showErrorMessage('Chromium or Chrome does not exist! \
      See https://github.com/yzane/vscode-md2pdf#install');
    return;
  }

  var StatusbarMessageTimeout = vscode.workspace.getConfiguration('markdown-pdf')['StatusbarMessageTimeout'];
  vscode.window.setStatusBarMessage('');
  let exportFilename: string = getOutputDir(filename, uri) || 'temp';

  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: '[md2pdf]: Exporting (' + type + ') ...'
  }, async () => {
    try {
      // export html
      if (type == 'html') {
        exportHtml(data, exportFilename);
        vscode.window.setStatusBarMessage('$(markdown) ' + exportFilename, StatusbarMessageTimeout);
        return;
      }

      const puppeteer = require('puppeteer-core');
      // create temporary file
      var f = path.parse(filename);
      var tmpfilename = path.join(f.dir, f.name + '_tmp.html');
      exportHtml(data, tmpfilename);
      var options = {
        executablePath: vscode.workspace.getConfiguration('markdown-pdf')['executablePath'] || puppeteer.executablePath(),
        args: ['--lang=' + vscode.env.language, '--no-sandbox', '--disable-setuid-sandbox']
        // Setting Up Chrome Linux Sandbox
        // https://github.com/puppeteer/puppeteer/blob/master/docs/troubleshooting.md#setting-up-chrome-linux-sandbox
      };
      const browser = await puppeteer.launch(options);
      const page = await browser.newPage();
      await page.goto(vscode.Uri.file(tmpfilename).toString(), { waitUntil: 'networkidle0' });
      // generate pdf
      // https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagepdfoptions
      if (type == 'pdf') {
        // If width or height option is set, it overrides the format option.
        // In order to set the default value of page size to A4, we changed it from the specification of puppeteer.
        var width_option = vscode.workspace.getConfiguration('markdown-pdf', uri)['width'] || '';
        var height_option = vscode.workspace.getConfiguration('markdown-pdf', uri)['height'] || '';
        var format_option = '';
        if (!width_option && !height_option) {
          format_option = vscode.workspace.getConfiguration('markdown-pdf', uri)['format'] || 'A4';
        }
        var landscape_option;
        if (vscode.workspace.getConfiguration('markdown-pdf', uri)['orientation'] == 'landscape') {
          landscape_option = true;
        } else {
          landscape_option = false;
        }
        let options = {
          path: exportFilename,
          scale: vscode.workspace.getConfiguration('markdown-pdf', uri)['scale'],
          displayHeaderFooter: vscode.workspace.getConfiguration('markdown-pdf', uri)['displayHeaderFooter'],
          headerTemplate: vscode.workspace.getConfiguration('markdown-pdf', uri)['headerTemplate'] || '',
          footerTemplate: vscode.workspace.getConfiguration('markdown-pdf', uri)['footerTemplate'] || '',
          printBackground: vscode.workspace.getConfiguration('markdown-pdf', uri)['printBackground'],
          landscape: landscape_option,
          pageRanges: vscode.workspace.getConfiguration('markdown-pdf', uri)['pageRanges'] || '',
          format: format_option,
          width: vscode.workspace.getConfiguration('markdown-pdf', uri)['width'] || '',
          height: vscode.workspace.getConfiguration('markdown-pdf', uri)['height'] || '',
          margin: {
            top: vscode.workspace.getConfiguration('markdown-pdf', uri)['margin']['top'] || '',
            right: vscode.workspace.getConfiguration('markdown-pdf', uri)['margin']['right'] || '',
            bottom: vscode.workspace.getConfiguration('markdown-pdf', uri)['margin']['bottom'] || '',
            left: vscode.workspace.getConfiguration('markdown-pdf', uri)['margin']['left'] || ''
          }
        }
        await page.pdf(options);
      }

      // generate png and jpeg
      // https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagescreenshotoptions
      if (type == 'png' || type == 'jpeg') {
        // Quality options do not apply to PNG images.
        var quality_option;
        if (type == 'png') {
          quality_option = undefined;
        }
        if (type == 'jpeg') {
          quality_option = vscode.workspace.getConfiguration('markdown-pdf')['quality'] || 100;
        }

        // screenshot size
        var clip_x_option = vscode.workspace.getConfiguration('markdown-pdf')['clip']['x'] || null;
        var clip_y_option = vscode.workspace.getConfiguration('markdown-pdf')['clip']['y'] || null;
        var clip_width_option = vscode.workspace.getConfiguration('markdown-pdf')['clip']['width'] || null;
        var clip_height_option = vscode.workspace.getConfiguration('markdown-pdf')['clip']['height'] || null;
        let options;
        if (clip_x_option !== null && clip_y_option !== null && clip_width_option !== null && clip_height_option !== null) {
          options = {
            path: exportFilename,
            quality: quality_option,
            fullPage: false,
            clip: {
              x: clip_x_option,
              y: clip_y_option,
              width: clip_width_option,
              height: clip_height_option,
            },
            omitBackground: vscode.workspace.getConfiguration('markdown-pdf')['omitBackground'],
          }
        } else {
          options = {
            path: exportFilename,
            quality: quality_option,
            fullPage: true,
            omitBackground: vscode.workspace.getConfiguration('markdown-pdf')['omitBackground'],
          }
        }
        await page.screenshot(options);
      }

      await browser.close();

      // delete temporary file
      var debug = vscode.workspace.getConfiguration('markdown-pdf')['debug'] || false;
      if (!debug) {
        if (isExistsPath(tmpfilename)) {
          deleteFile(tmpfilename);
        }
      }

      vscode.window.setStatusBarMessage('$(markdown) ' + exportFilename, StatusbarMessageTimeout);
    } catch (error) {
      showErrorMessage('exportPdf()', error);
    }
  } // async
  ); // vscode.window.withProgress
}

function isExistsPath(path: string) {
  if (path.length === 0) {
    return false;
  }
  try {
    fs.accessSync(path);
    return true;
  } catch (error: any) {
    console.warn(error.message);
    return false;
  }
}

function isExistsDir(dirname: string) {
  if (dirname.length === 0) {
    return false;
  }
  try {
    if (fs.statSync(dirname).isDirectory()) {
      return true;
    } else {
      console.warn('Directory does not exist!');
      return false;
    }
  } catch (error: any) {
    console.warn(error.message);
    return false;
  }
}

function deleteFile(path: string) {
  var rimraf = require('rimraf')
  rimraf.sync(path);
}

function getOutputDir(filename: string, resource: vscode.Uri | undefined) {
  try {
    var outputDir;
    if (resource === undefined) {
      return filename;
    }
    var outputDirectory = vscode.workspace.getConfiguration('markdown-pdf')['outputDirectory'] || '';
    if (outputDirectory.length === 0) {
      return filename;
    }

    // Use a home directory relative path If it starts with ~.
    if (outputDirectory.indexOf('~') === 0) {
      outputDir = outputDirectory.replace(/^~/, os.homedir());
      mkdir(outputDir);
      return path.join(outputDir, path.basename(filename));
    }

    // Use path if it is absolute
    if (path.isAbsolute(outputDirectory)) {
      if (!isExistsDir(outputDirectory)) {
        showErrorMessage(`The output directory specified by the md2pdf.outputDirectory option does not exist.\
          Check the md2pdf.outputDirectory option. ` + outputDirectory);
        return;
      }
      return path.join(outputDirectory, path.basename(filename));
    }

    // Use a workspace relative path if there is a workspace and md2pdf.outputDirectoryRootPath = workspace
    var outputDirectoryRelativePathFile = vscode.workspace.getConfiguration('markdown-pdf')['outputDirectoryRelativePathFile'];
    let root = vscode.workspace.getWorkspaceFolder(resource);
    if (outputDirectoryRelativePathFile === false && root) {
      outputDir = path.join(root.uri.fsPath, outputDirectory);
      mkdir(outputDir);
      return path.join(outputDir, path.basename(filename));
    }

    // Otherwise look relative to the markdown file
    outputDir = path.join(path.dirname(resource.fsPath), outputDirectory);
    mkdir(outputDir);
    return path.join(outputDir, path.basename(filename));
  } catch (error) {
    showErrorMessage('getOutputDir()', error);
  }
}

function mkdir(path: string) {
  if (isExistsDir(path)) {
    return;
  }
  var mkdirp = require('mkdirp');
  return mkdirp.sync(path);
}

function readFile(filename: string, encode: string = 'utf-8') {
  if (filename.length === 0) {
    return '';
  }
  if (!encode && encode !== null) {
    encode = 'utf-8';
  }
  if (filename.indexOf('file://') === 0) {
    if (process.platform === 'win32') {
      filename = filename.replace(/^file:\/\/\//, '')
        .replace(/^file:\/\//, '');
    } else {
      filename = filename.replace(/^file:\/\//, '');
    }
  }
  if (isExistsPath(filename)) {
    return fs.readFileSync(filename, { encoding: 'utf-8', flag: 'r' });
  } else {
    return '';
  }
}

function convertImgPath(src: string, filename: string) {
  try {
    var href = decodeURIComponent(src);
    href = href.replace(/("|')/g, '')
      .replace(/\\/g, '/')
      .replace(/#/g, '%23');
    var protocol = url.parse(href).protocol;
    if (protocol === 'file:' && href.indexOf('file:///') !== 0) {
      return href.replace(/^file:\/\//, 'file:///');
    } else if (protocol === 'file:') {
      return href;
    } else if (!protocol || path.isAbsolute(href)) {
      href = path.resolve(path.dirname(filename), href).replace(/\\/g, '/')
        .replace(/#/g, '%23');
      if (href.indexOf('//') === 0) {
        return 'file:' + href;
      } else if (href.indexOf('/') === 0) {
        return 'file://' + href;
      } else {
        return 'file:///' + href;
      }
    } else {
      return src;
    }
  } catch (error) {
    showErrorMessage('convertImgPath()', error);
  }
}

function makeCss(filename: string) {
  try {
    var css = readFile(filename);
    if (css) {
      return '\n<style>\n' + css + '\n</style>\n';
    } else {
      return '';
    }
  } catch (error: any) {
    showErrorMessage('makeCss()', error);
  }
}

function readStyles(uri: vscode.Uri) {
  try {
    var includeDefaultStyles;
    var style = '';
    var styles = '';
    var filename = '';
    var i;

    includeDefaultStyles = vscode.workspace.getConfiguration('markdown-pdf')['includeDefaultStyles'];

    // 1. read the style of the vscode.
    if (includeDefaultStyles) {
      filename = path.join(__dirname, '..', 'styles', 'markdown.css');
      style += makeCss(filename);
    }

    // 2. read the style of the markdown.styles setting.
    if (includeDefaultStyles) {
      styles = vscode.workspace.getConfiguration('markdown')['styles'];
      if (styles && Array.isArray(styles) && styles.length > 0) {
        for (i = 0; i < styles.length; i++) {
          var href = fixHref(uri, styles[i]);
          style += '<link rel=\"stylesheet\" href=\"' + href + '\" type=\"text/css\">';
        }
      }
    }

    // 3. read the style of the highlight.js.
    var highlightStyle = vscode.workspace.getConfiguration('markdown-pdf')['highlightStyle'] || '';
    var ishighlight = vscode.workspace.getConfiguration('markdown-pdf')['highlight'];
    if (ishighlight) {
      if (highlightStyle) {
        var css = vscode.workspace.getConfiguration('markdown-pdf')['highlightStyle'] || 'github.css';
        filename = path.join(__dirname, '..', 'node_modules', 'highlight.js', 'styles', css);
        style += makeCss(filename);
      } else {
        filename = path.join(__dirname, '..', 'styles', 'tomorrow.css');
        style += makeCss(filename);
      }
    }

    // 4. read the style of the md2pdf.
    if (includeDefaultStyles) {
      filename = path.join(__dirname, '..', 'styles', 'md2pdf.css');
      style += makeCss(filename);
    }

    // 5. read the style of the md2pdf.styles settings.
    styles = vscode.workspace.getConfiguration('markdown-pdf')['styles'] || '';
    if (styles && Array.isArray(styles) && styles.length > 0) {
      for (i = 0; i < styles.length; i++) {
        var href = fixHref(uri, styles[i]);
        style += '<link rel=\"stylesheet\" href=\"' + href + '\" type=\"text/css\">';
      }
    }

    return style;
  } catch (error) {
    showErrorMessage('readStyles()', error);
  }
}

/*
 * vscode/extensions/markdown-language-features/src/features/previewContentProvider.ts fixHref()
 * https://github.com/Microsoft/vscode/blob/0c47c04e85bc604288a288422f0a7db69302a323/extensions/markdown-language-features/src/features/previewContentProvider.ts#L95
 *
 * Extension Authoring: Adopting Multi Root Workspace APIs ?E Microsoft/vscode Wiki
 * https://github.com/Microsoft/vscode/wiki/Extension-Authoring:-Adopting-Multi-Root-Workspace-APIs
 */
function fixHref(resource: vscode.Uri, href: string) {
  try {
    if (!href) {
      return href;
    }

    // Use href if it is already an URL
    const hrefUri = vscode.Uri.parse(href);
    if (['http', 'https'].indexOf(hrefUri.scheme) >= 0) {
      return hrefUri.toString();
    }

    // Use a home directory relative path If it starts with ^.
    if (href.indexOf('~') === 0) {
      return vscode.Uri.file(href.replace(/^~/, os.homedir())).toString();
    }

    // Use href as file URI if it is absolute
    if (path.isAbsolute(href)) {
      return vscode.Uri.file(href).toString();
    }

    // Use a workspace relative path if there is a workspace and md2pdf.stylesRelativePathFile is false
    var stylesRelativePathFile = vscode.workspace.getConfiguration('markdown-pdf')['stylesRelativePathFile'];
    let root = vscode.workspace.getWorkspaceFolder(resource);
    if (stylesRelativePathFile === false && root) {
      return vscode.Uri.file(path.join(root.uri.fsPath, href)).toString();
    }

    // Otherwise look relative to the markdown file
    return vscode.Uri.file(path.join(path.dirname(resource.fsPath), href)).toString();
  } catch (error) {
    showErrorMessage('fixHref()', error);
  }
}

function checkPuppeteerBinary() {
  try {
    // settings.json
    var executablePath = vscode.workspace.getConfiguration('markdown-pdf')['executablePath'] || ''
    if (isExistsPath(executablePath)) {
      INSTALL_CHECK = true;
      return true;
    }

    // bundled Chromium
    const puppeteer = require('puppeteer-core');
    executablePath = puppeteer.executablePath();
    if (isExistsPath(executablePath)) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    showErrorMessage('checkPuppeteerBinary()', error);
  }
}

/*
 * puppeteer install.js
 * https://github.com/GoogleChrome/puppeteer/blob/master/install.js
 */
function installChromium() {
  try {
    vscode.window.showInformationMessage('[md2pdf] Installing Chromium ...');
    let statusbarmessage = vscode.window.setStatusBarMessage('$(markdown) Installing Chromium ...');

    // proxy setting
    setProxy();

    let localMirror = vscode.workspace.getConfiguration('markdown-pdf')['localMirror'];
    if (localMirror) { process.env.PUPPETEER_DOWNLOAD_HOST = 'https://npm.taobao.org/mirrors'; }

    let StatusbarMessageTimeout = vscode.workspace.getConfiguration('markdown-pdf')['StatusbarMessageTimeout'];
    const puppeteer = require('puppeteer-core');
    const browserFetcher = puppeteer.createBrowserFetcher();
    const revision: string = require(path.join(__dirname, '..', 'node_modules', 'puppeteer-core', 'package.json')).puppeteer.chromium_revision;
    const revisionInfo = browserFetcher.revisionInfo(revision);

    // download Chromium
    browserFetcher.download(revisionInfo.revision, onProgress)
      .then(() => browserFetcher.localRevisions())
      .then(onSuccess)
      .catch(onError);

    function onSuccess(localRevisions: any) {
      console.log('Chromium downloaded to ' + revisionInfo.folderPath);
      localRevisions = localRevisions.filter((revision: any) => revision !== revisionInfo.revision);
      // Remove previous chromium revisions.
      const cleanupOldVersions = localRevisions.map((revision: any) => browserFetcher.remove(revision));

      if (checkPuppeteerBinary()) {
        INSTALL_CHECK = true;
        statusbarmessage.dispose();
        vscode.window.setStatusBarMessage('$(markdown) Chromium installation succeeded!', StatusbarMessageTimeout);
        vscode.window.showInformationMessage('[md2pdf] Chromium installation succeeded.');
        return Promise.all(cleanupOldVersions);
      }
    }

    function onError(error: any) {
      statusbarmessage.dispose();
      vscode.window.setStatusBarMessage('$(markdown) ERROR: Failed to download Chromium!', StatusbarMessageTimeout);
      showErrorMessage('Failed to download Chromium! \
        If you are behind a proxy, set the http.proxy option to settings.json and restart Visual Studio Code. \
        ', error);
    }

    function onProgress(downloadedBytes: number, totalBytes: number) {
      let progress = downloadedBytes / totalBytes * 100;
      vscode.window.setStatusBarMessage('$(markdown) Installing Chromium ' + progress + '%', StatusbarMessageTimeout);
    }
  } catch (error) {
    showErrorMessage('installChromium()', error);
  }
}

function showErrorMessage(msg: string, error: any = '') {
  vscode.window.showErrorMessage('ERROR: ' + msg);
  console.log('ERROR: ' + msg);
  if (error) {
    vscode.window.showErrorMessage(error.toString());
    console.log(error);
  }
}

function setProxy() {
  var https_proxy = vscode.workspace.getConfiguration('http')['proxy'] || '';
  if (https_proxy) {
    process.env.HTTPS_PROXY = https_proxy;
    process.env.HTTP_PROXY = https_proxy;
  }
}

function setBooleanValue(a: Boolean, b: Boolean) {
  if (a === false) {
    return false
  } else {
    return a || b
  }
}

function init() {
  try {
    if (checkPuppeteerBinary()) {
      INSTALL_CHECK = true;
    } else {
      installChromium();
    }
  } catch (error) {
    showErrorMessage('init()', error);
  }
}
