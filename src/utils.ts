//import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as url from 'url';
import * as os from 'os';

import { extensionName } from "./defaults";
import { log } from "./log";
//import * as utils from "./utils";

export function setBooleanValue(a: Boolean, b: Boolean) {
  if (a === false) {
    return false
  } else {
    return a || b
  }
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

function mkdir(path: string) {
  if (isExistsDir(path)) {
    return;
  }
  var mkdirp = require('mkdirp');
  return mkdirp.sync(path);
}

export function readFile(filename: string, encode: string = 'utf-8') {
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

export function convertImgPath(src: string, filename: string) {
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
  } catch (error: any) {
    log.error('convertImgPath()'); log.error(error);
  }
}

export function getConfiguration(section?: string): undefined {
  return undefined
}
