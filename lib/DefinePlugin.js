/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
"use strict";

const ConstDependency = require("./dependencies/ConstDependency");
const BasicEvaluatedExpression = require("./BasicEvaluatedExpression");
const NullFactory = require("./NullFactory");

class DefinePlugin {
	constructor(definitions) {
		this.definitions = definitions;
	}

	apply(compiler) {
		let definitions = this.definitions;
		compiler.plugin("compilation", (compilation, params) => {
			compilation.dependencyFactories.set(ConstDependency, new NullFactory());
			compilation.dependencyTemplates.set(ConstDependency, new ConstDependency.Template());

			params.normalModuleFactory.plugin("parser", (parser) => {
				(function walkDefinitions(definitions, prefix) {
					Object.keys(definitions).forEach((key) => {
						let code = definitions[key];
						if(code && typeof code === "object" && !(code instanceof RegExp)) {
							walkDefinitions(code, prefix + key + ".");
							applyObjectDefine(prefix + key, code);
							return;
						}
						applyDefineKey(prefix, key);
						applyDefine(prefix + key, code);
					});
				}(definitions, ""));

				function stringifyObj(obj) {
					return "{" + Object.keys(obj).map((key) => {
						let code = obj[key];
						return JSON.stringify(key) + ":" + toCode(code);
					}).join(",") + "}";
				}

				function toCode(code) {
					if(code === null) return "null";
					else if(code === undefined) return "undefined";
					else if(code instanceof RegExp && code.toString) return code.toString();
					else if(typeof code === "function" && code.toString) return "(" + code.toString() + ")";
					else if(typeof code === "object") return stringifyObj(code);
					else return code + "";
				}

				function applyDefineKey(prefix, key) {
					const splittedKey = key.split(".");
					splittedKey.slice(1).forEach((_, i) => {
						const fullKey = prefix + splittedKey.slice(0, i + 1).join(".");
						parser.plugin("can-rename " + fullKey, () => true);
					});
				}

				function applyDefine(key, code) {
					let isTypeof = /^typeof\s+/.test(key);
					if(isTypeof) key = key.replace(/^typeof\s+/, "");
					let recurse = false;
					let recurseTypeof = false;
					code = toCode(code);
					if(!isTypeof) {
						parser.plugin("can-rename " + key, () => true);
						parser.plugin("evaluate Identifier " + key, (expr) => {
							if(recurse) return;
							let res = parser.evaluate(code);
							recurse = false;
							res.setRange(expr.range);
							return res;
						});
						parser.plugin("expression " + key, (expr) => {
							let dep = new ConstDependency(code, expr.range);
							dep.loc = expr.loc;
							parser.state.current.addDependency(dep);
							return true;
						});
					}
					let typeofCode = isTypeof ? code : "typeof (" + code + ")";
					parser.plugin("evaluate typeof " + key, (expr) => {
						if(recurseTypeof) return;
						let res = parser.evaluate(typeofCode);
						recurseTypeof = false;
						res.setRange(expr.range);
						return res;
					});
					parser.plugin("typeof " + key, (expr) => {
						let res = parser.evaluate(typeofCode);
						if(!res.isString()) return;
						let dep = new ConstDependency(JSON.stringify(res.string), expr.range);
						dep.loc = expr.loc;
						parser.state.current.addDependency(dep);
						return true;
					});
				}

				function applyObjectDefine(key, obj) {
					let code = stringifyObj(obj);
					parser.plugin("can-rename " + key, () => true);
					parser.plugin("evaluate Identifier " + key, (expr) => new BasicEvaluatedExpression().setRange(expr.range));
					parser.plugin("evaluate typeof " + key, expr => new BasicEvaluatedExpression().setString("object").setRange(expr.range));
					parser.plugin("expression " + key, (expr) => {
						let dep = new ConstDependency(code, expr.range);
						dep.loc = expr.loc;
						parser.state.current.addDependency(dep);
						return true;
					});
					parser.plugin("typeof " + key, (expr) => {
						let dep = new ConstDependency("\"object\"", expr.range);
						dep.loc = expr.loc;
						parser.state.current.addDependency(dep);
						return true;
					});
				}
			});
		});
	}
}
module.exports = DefinePlugin;
