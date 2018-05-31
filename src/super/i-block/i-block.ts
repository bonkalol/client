/*!
 * V4Fire Client Core
 * https://github.com/V4Fire/Client
 *
 * Released under the MIT license
 * https://github.com/V4Fire/Client/blob/master/LICENSE
 */

// tslint:disable:max-file-line-count
import $C = require('collection.js');
import Async, { AsyncOpts } from 'core/async';

import * as analytics from 'core/analytics';
import { EventEmitter2 as EventEmitter } from 'eventemitter2';
import { WatchOptions, WatchOptionsWithHandler, RenderContext, VNode } from 'vue';

import 'super/i-block/directives';
import Block from 'super/i-block/modules/block';
import Cache from 'super/i-block/modules/cache';
import { icons, iconsMap } from 'super/i-block/modules/icons';
import symbolGenerator from 'core/symbol';

import iPage from 'super/i-page/i-page';
import bRouter, { PageInfo } from 'base/b-router/b-router';
import { asyncLocal, AsyncNamespace } from 'core/kv-storage';
import {

	component,
	hook,
	execRenderObject,
	patchVNode,
	ModVal,
	ModsDecl,
	VueInterface,
	VueElement,
	ComponentMeta,
	Hooks,
	PARENT

} from 'core/component';

import { prop, field, system, watch, wait, p } from 'super/i-block/modules/decorators';
import { queue, backQueue } from 'core/render';
import { delegate } from 'core/dom';

import * as helpers from 'core/helpers';
import * as browser from 'core/const/browser';

export * from 'core/component';
export { default as Cache } from 'super/i-block/modules/cache';
export {

	prop,
	field,
	system,
	watch,
	wait,
	bindModTo,
	mod,
	removeMod,
	elMod,
	removeElMod

} from 'super/i-block/modules/decorators';

export type Classes = Dictionary<string | Array<string | true> | true>;
export type WatchObjectField =
	string |
	[string] |
	[string, string] |
	[string, LinkWrapper] |
	[string, string, LinkWrapper];

export type WatchObjectFields = Array<WatchObjectField>;
export interface LinkWrapper {
	(this: this, value: any, oldValue: any): any;
}

export interface SizeTo {
	gt: Dictionary<string>;
	lt: Dictionary<string>;
}

export interface SyncLink {
	path: string;
	sync(value?: any): void;
}

export type SyncLinkCache = Dictionary<Dictionary<SyncLink>>;
export type ModsTable = Dictionary<ModVal>;
export type ModsNTable = Dictionary<string | undefined>;

export type Statuses =
	'destroyed' |
	'inactive' |
	'loading' |
	'beforeReady' |
	'ready' |
	'unloaded';

/**
 * Enum of available component statuses
 */
export enum statuses {
	destroyed = -1,
	inactive = 0,
	loading = 1,
	beforeReady = 2,
	ready = 3,
	unloaded = 0
}

export const
	$$ = symbolGenerator(),
	modsCache = Object.createDict(),
	literalCache = Object.createDict(),
	classesCache = new Cache<'base' | 'blocks' | 'els'>(['base', 'blocks', 'els']);

@component()
export default class iBlock extends VueInterface<iBlock, iPage> {
	/**
	 * Returns a link for the specified icon
	 * @param iconId
	 */
	static getIconLink(iconId: string): string {
		if (!(iconId in iconsMap)) {
			throw new ReferenceError(`The specified icon "${iconId}" is not defined`);
		}

		const q = location.search || (location.href.slice(-1) === '?' ? '?' : '');
		return `${location.pathname + q}#${icons(iconsMap[iconId]).id}`;
	}

	/**
	 * Component unique id
	 */
	@system({
		atom: true,
		unique: (ctx, oldCtx) => !ctx.$el.classList.contains(oldCtx.componentId),
		init: () => `uid-${Math.random().toString().slice(2)}`
	})

	readonly componentId!: string;

	/**
	 * Link to i18n function
	 */
	@prop(Function)
	readonly i18n: typeof i18n = defaultI18n;

	/**
	 * Component unique name
	 */
	@prop({type: String, required: false})
	readonly globalName?: string;

	/**
	 * Component initialize status
	 */
	@p({cache: false})
	get componentStatus(): Statuses {
		return this.getField('componentStatusStore');
	}

	/**
	 * Sets a new component initialize status
	 * @param value
	 */
	set componentStatus(value: Statuses) {
		if (this.componentStatus === value) {
			return;
		}

		this.setField('componentStatusStore', value);
		this.localEvent.emit(`component.status.${value}`, value);
		this.emit(`status-${value}`, value);
	}

	/**
	 * Initial component modifiers
	 */
	@prop(Object)
	readonly modsProp: ModsTable = {};

	/**
	 * Initial component stage
	 */
	@prop({type: String, required: false})
	readonly stageProp?: string;

	/**
	 * Component stage
	 */
	@field((o) => o.link())
	stage?: string;

	/**
	 * Group name for the current stage
	 */
	get stageGroup(): string {
		return `stage.${this.stage}`;
	}

	/**
	 * Dispatching mode
	 */
	@prop(Boolean)
	readonly dispatching: boolean = false;

	/**
	 * If true, then the component marked as remote provider
	 */
	@prop(Boolean)
	readonly remoteProvider: boolean = false;

	/**
	 * If true, then the component will be reinitialized after activated
	 */
	@prop(Boolean)
	readonly needReInit: boolean = false;

	/**
	 * Additional classes for component elements
	 */
	@prop(Object)
	readonly classes: Classes = {};

	/**
	 * Advanced component parameters
	 */
	@prop(Object)
	readonly p: Dictionary = {};

	/**
	 * True if the current component is activated (keep-alive)
	 */
	@system({unique: true})
	isActivated: boolean = true;

	/**
	 * Link to $root
	 */
	get r(): iPage | any {
		return this.$root;
	}

	/**
	 * Link to the root router
	 */
	get router(): bRouter | any | undefined {
		return this.$root.routerStore;
	}

	/**
	 * Link to the root pageInfo object
	 */
	get route(): PageInfo | any | undefined {
		return this.$root.pageInfo;
	}

	/**
	 * True if the current component is functional
	 */
	get isFunctional(): boolean {
		return this.meta.params.functional === true;
	}

	/**
	 * Base component modifiers
	 */
	get baseMods(): Readonly<ModsNTable> {
		const
			m = this.mods;

		return Object.freeze({
			theme: m.theme,
			size: m.size
		});
	}

	/**
	 * Component modifiers
	 */
	@system({
		merge: (ctx, oldCtx, key, link) => {
			if (!link) {
				return;
			}

			const
				l = ctx.syncLinkCache[link][key],
				modsProp = ctx.$props[link],
				mods = {...oldCtx.mods};

			for (let keys = Object.keys(mods), i = 0; i < keys.length; i++) {
				const
					key = keys[i];

				if (ctx.syncModCache[key]) {
					delete mods[key];
				}
			}

			if (Object.fastCompare(modsProp, oldCtx.$props[link])) {
				l.sync(mods);

			} else {
				// tslint:disable-next-line:prefer-object-spread
				l.sync(Object.assign(mods, modsProp));
			}
		},

		init: (o) => {
			const
				declMods = o.meta.component.mods,
				attrMods = <string[][]>[],
				modVal = (val) => val != null ? String(val) : val;

			for (let attrs = o.$attrs, keys = Object.keys(attrs), i = 0; i < keys.length; i++) {
				const
					key = keys[i];

				if (key in declMods) {
					attrMods.push([key, attrs[key]]);
					o.$watch(`$attrs.${key}`, (val) => o.setMod(key, modVal(val)));
					delete attrs[key];
				}
			}

			return o.link((val) => {
				const
					declMods = o.meta.component.mods,
					// tslint:disable-next-line:prefer-object-spread
					mods = Object.assign(o.mods || {...declMods}, val);

				for (let i = 0; i < attrMods.length; i++) {
					const [key, val] = attrMods[i];
					mods[key] = val;
				}

				for (let keys = Object.keys(mods), i = 0; i < keys.length; i++) {
					const
						key = keys[i],
						val = modVal(mods[key]);

					mods[key] = val;
					o.hook !== 'beforeDataCreate' && o.setMod(key, val);
				}

				return mods;
			});
		}
	})

	readonly mods!: ModsNTable;

	/**
	 * Parent link
	 */
	static readonly PARENT: object = PARENT;

	/**
	 * Component modifiers
	 */
	static readonly mods: ModsDecl = {
		theme: [
			['default']
		],

		size: [
			'xxs',
			'xs',
			's',
			['m'],
			'xs',
			'xxs'
		],

		progress: [
			'true',
			['false']
		],

		disabled: [
			'true',
			['false']
		],

		focused: [
			'true',
			['false']
		],

		hidden: [
			'true',
			['false']
		],

		width: [
			['normal'],
			'full',
			'auto'
		]
	};

	/**
	 * Size converter
	 */
	static sizeTo: SizeTo = {
		gt: {
			xxl: 'xxl',
			xl: 'xxl',
			l: 'xl',
			m: 'l',
			undefined: 'l',
			s: 'm',
			xs: 's',
			xxs: 'xs'
		},

		lt: {
			xxl: 'xl',
			xl: 'l',
			l: 'm',
			m: 's',
			undefined: 's',
			s: 'xs',
			xs: 'xxs',
			xxs: 'xxs'
		}
	};

	/**
	 * Alias for iBlock.sizeTo.gt
	 */
	protected get gt(): Dictionary<string> {
		return (<typeof iBlock>this.instance.constructor).sizeTo.gt;
	}

	/**
	 * Alias for iBlock.sizeTo.lt
	 */
	protected get lt(): Dictionary<string> {
		return (<typeof iBlock>this.instance.constructor).sizeTo.lt;
	}

	/**
	 * Alias for .$refs
	 */
	protected get refs(): Dictionary {
		return $C(this.$refs).map((el) => el && (<any>el).vueComponent || el);
	}

	/**
	 * Link to bIcon.getIconLink
	 */
	protected get getIconLink(): typeof iBlock.getIconLink {
		return (<typeof iBlock>this.instance.constructor).getIconLink;
	}

	/**
	 * Number of beforeReady event listeners
	 * @type {number}
	 */
	@system({unique: true})
	protected beforeReadyListeners: number = 0;

	/**
	 * Component initialize status store
	 */
	@system({unique: true})
	protected componentStatusStore: Statuses = 'unloaded';

	/**
	 * Watched store of component modifiers
	 */
	@field({merge: true})
	protected watchModsStore: ModsNTable = {};

	/**
	 * Watched component modifiers
	 */
	protected get m(): Readonly<ModsNTable> {
		const
			o = {},
			w = this.watchModsStore,
			m = this.mods;

		for (let keys = Object.keys(m), i = 0; i < keys.length; i++) {
			const
				key = keys[i],
				val = m[key];

			if (key in w) {
				o[key] = val;

			} else {
				Object.defineProperty(o, key, {
					get: () => {
						if (!(key in w)) {
							w[key] = val;
						}

						return val;
					}
				});
			}
		}

		return Object.freeze(o);
	}

	/**
	 * Cache of ifOnce
	 */
	@field({merge: true})
	protected readonly ifOnceStore: Dictionary = {};

	/**
	 * Temporary cache
	 */
	@system({merge: true})
	protected tmp: Dictionary = {};

	/**
	 * Temporary cache with watching
	 */
	@field({merge: true})
	protected watchTmp: Dictionary = {};

	/**
	 * Cache for prop/field links
	 */
	@system({unique: true})
	protected readonly linksCache!: Dictionary<Dictionary>;

	/**
	 * Cache for prop/field synchronize functions
	 */
	@system({unique: true})
	protected readonly syncLinkCache!: SyncLinkCache;

	/**
	 * Cache for modifiers synchronize functions
	 */
	@system({unique: true})
	protected readonly syncModCache!: Dictionary<Function>;

	/**
	 * Link to the current Vue component
	 */
	@system({
		atom: true,
		unique: true,
		init: (ctx) => ctx
	})

	protected readonly self!: this;

	/**
	 * API for async operations
	 */
	@system({
		atom: true,
		unique: true,
		init: (ctx) => new Async(ctx)
	})

	protected readonly async!: Async<this>;

	/**
	 * API for BEM like develop
	 */
	@system({unique: true})
	protected block!: Block;

	/**
	 * Local event emitter
	 */
	@system({
		atom: true,
		unique: true,
		init: () => new EventEmitter({maxListeners: 100, wildcard: true})
	})

	protected readonly localEvent!: EventEmitter;

	/**
	 * Storage object
	 */
	@system({
		atom: true,
		unique: true,
		init: (o) => asyncLocal.namespace(o.componentName)
	})

	protected readonly storage!: AsyncNamespace;

	/**
	 * Async loading state
	 */
	@field()
	protected asyncLoading: boolean = false;

	/**
	 * Counter of async components
	 */
	@field()
	protected asyncCounter: number = 0;

	/**
	 * Queue of async components
	 */
	@system()
	protected readonly asyncQueue: Set<Function> = new Set();

	/**
	 * Cache of child async components
	 */
	@field({unique: true})
	protected readonly asyncComponents: Dictionary<string> = {};

	/**
	 * Cache of child background async components
	 */
	@field({unique: true})
	protected readonly asyncBackComponents: Dictionary<string> = {};

	/**
	 * Some helpers
	 */
	@system({
		atom: true,
		unique: true,
		init: () => helpers
	})

	protected readonly h!: typeof helpers;

	/**
	 * Browser constants
	 */
	@system({
		atom: true,
		unique: true,
		init: () => browser
	})

	protected readonly b!: typeof browser;

	/**
	 * Alias for .i18n
	 */
	protected get t(): typeof i18n {
		return this.i18n;
	}

	/**
	 * Link to window.l
	 */
	@system({
		atom: true,
		unique: true,
		init: () => l
	})

	protected readonly l!: typeof l;

	/**
	 * Link to console API
	 */
	@system({
		atom: true,
		unique: true,
		init: () => console
	})

	protected readonly console!: Console;

	/**
	 * Link to window.location
	 */
	@system({
		atom: true,
		unique: true,
		init: () => location
	})

	protected readonly location!: Location;

	/**
	 * Link to the global object
	 */
	@system({
		unique: true,
		init: () => window
	})
	protected readonly global!: Window;

	/**
	 * Returns a string id, which is connected to the component
	 * @param id - custom id
	 */
	getConnectedId(id: string | void): string | undefined {
		if (!id) {
			return undefined;
		}

		return `${this.componentId}-${id}`;
	}

	/**
	 * Wrapper for $emit
	 *
	 * @param event
	 * @param args
	 */
	emit(event: string, ...args: any[]): void {
		event = event.dasherize();
		this.$emit(event, this, ...args);
		this.$emit(`on-${event}`, ...args);
		this.dispatching && this.dispatch(event, ...args);
	}

	/**
	 * Emits the specified event for the parent component
	 *
	 * @param event
	 * @param args
	 */
	dispatch(event: string, ...args: any[]): void {
		event = event.dasherize();

		let
			obj = this.$parent;

		while (obj) {
			obj.$emit(`${this.componentName}::${event}`, this, ...args);

			if (this.globalName) {
				obj.$emit(`${this.globalName.dasherize()}::${event}`, this, ...args);
			}

			if (!obj.dispatching) {
				break;
			}

			obj = obj.$parent;
		}
	}

	/**
	 * Wrapper for $on
	 *
	 * @param event
	 * @param cb
	 */
	on(event: string, cb: Function): void {
		this.$on(event.dasherize(), cb);
	}

	/**
	 * Wrapper for $once
	 *
	 * @param event
	 * @param cb
	 */
	once(event: string, cb: Function): void {
		this.$once(event.dasherize(), cb);
	}

	/**
	 * Wrapper for $off
	 *
	 * @param [event]
	 * @param [cb]
	 */
	off(event?: string, cb?: Function): void {
		this.$off(event && event.dasherize(), cb);
	}

	/**
	 * Wrapper for @wait
	 *
	 * @see Async.promise
	 * @param status
	 * @param fn
	 * @param [params] - additional parameters:
	 *   *) [params.defer] - if true, then the function will always return a promise
	 */
	waitStatus<T>(status: Statuses, fn: (this: this) => T, params?: AsyncOpts & {defer?: boolean}): CanPromise<T> {
		params = params || {};
		params.join = false;
		return wait(status, {fn, ...params}).call(this);
	}

	/**
	 * Wrapper for $forceUpdate
	 */
	@wait({defer: true, label: $$.forceUpdate})
	async forceUpdate(): Promise<void> {
		this.$forceUpdate();
	}

	/**
	 * Loads component data
	 * @emits initLoad(data?: Object)
	 */
	@hook('beforeDataCreate')
	initLoad(data?: any | ((this: this) => any)): CanPromise<void> {
		this.componentStatus = 'loading';

		const
			{$children: $c, async: $a} = this,
			providers = new Set();

		if ($c) {
			const
				providers = new Set();

			for (let i = 0; i < $c.length; i++) {
				const
					el = $c[i];

				if (el.remoteProvider) {
					providers.add(el);
				}
			}
		}

		const done = () => {
			this.componentStatus = 'beforeReady';
			this.execCbAfterBlockReady(async () => {
				if (this.beforeReadyListeners) {
					await this.nextTick();
					this.beforeReadyListeners = 0;
				}

				this.componentStatus = 'ready';
				this.emit('initLoad', Object.isFunction(data) ? data.call(this) : data);
			});
		};

		if (this.globalName || providers.size) {
			const init = async () => {
				await this.loadLocalStore();

				if (providers.size) {
					await $a.wait(() => $C(providers).every((el) => {
						if (el.componentStatus === 'ready') {
							providers.delete(el);
							return true;
						}

						return false;
					}));
				}

				done();
			};

			return $a.promise(init, {join: true, label: $$.initLoad}).catch(stderr);
		}

		done();
	}

	/**
	 * Returns an array of component classes by the specified parameters
	 *
	 * @param [blockName] - name of the source component
	 * @param mods - map of modifiers
	 */
	getBlockClasses(blockName: string | undefined, mods: ModsTable): ReadonlyArray<string>;

	/**
	 * @param mods - map of modifiers
	 */
	getBlockClasses(mods: ModsTable): ReadonlyArray<string>;
	getBlockClasses(blockName: string | undefined | ModsTable, mods?: ModsTable): ReadonlyArray<string> {
		if (arguments.length === 1) {
			mods = <ModsTable>blockName;
			blockName = undefined;

		} else {
			mods = <ModsTable>mods;
			blockName = <string | undefined>blockName;
		}

		const
			key = JSON.stringify(mods) + blockName,
			cache = classesCache.create('blocks', this.componentName);

		if (cache[key]) {
			return cache[key];
		}

		const
			classes = cache[key] = [this.getFullBlockName(blockName)];

		for (let keys = Object.keys(mods), i = 0; i < keys.length; i++) {
			const
				key = keys[i],
				val = mods[key];

			if (val !== undefined) {
				classes.push(this.getFullBlockName(blockName, key, val));
			}
		}

		return classes;
	}

	/**
	 * Sets a component modifier
	 *
	 * @param name
	 * @param value
	 */
	setMod(name: string, value: any): CanPromise<boolean> {
		return this.execCbAfterBlockReady(() => this.block.setMod(name, value));
	}

	/**
	 * Removes a component modifier
	 *
	 * @param name
	 * @param [value]
	 */
	removeMod(name: string, value?: any): CanPromise<boolean> {
		return this.execCbAfterBlockReady(() => this.block.removeMod(name, value));
	}

	/**
	 * Sets a modifier to the root element
	 *
	 * @param name
	 * @param value
	 */
	setRootMod(name: string, value: any): boolean {
		return this.$root.setRootMod(name, value, this);
	}

	/**
	 * Removes a modifier from the root element
	 *
	 * @param name
	 * @param value
	 */
	removeRootMod(name: string, value?: any): boolean {
		return this.$root.removeRootMod(name, value, this);
	}

	/**
	 * Returns a value of the specified root element modifier
	 * @param name
	 */
	getRootMod(name: string): string | undefined {
		return this.$root.getRootMod(name, this);
	}

	/**
	 * Activates the component
	 * @emits activated()
	 */
	@hook(['beforeDataCreate', 'activated'])
	activate(): void {
		if (Object.keys(this.convertStateToRouter()).length) {
			this.initStateFromRouter();
			this.execCbAfterCreated(() => {
				this.async.on(this.$root, 'transition', this.initStateFromRouter, {
					label: $$.activate,
					group: 'routerStateWatchers'
				});
			});
		}

		this.emit('activated');
	}

	/**
	 * Deactivates the component
	 * @emits deactivated()
	 */
	@hook('deactivated')
	deactivate(): void {
		this.async
			.off({group: 'routerStateWatchers'})
			.off({group: 'routerWatchers'});

		$C(this.convertStateToRouter()).forEach((el, key) => this[key] = undefined);
		this.emit('deactivated');
	}

	/**
	 * Disables the component
	 * @emits disable()
	 */
	async disable(): Promise<boolean> {
		if (await this.setMod('disabled', true)) {
			this.emit('disable');
			return true;
		}

		return false;
	}

	/**
	 * Enables the component
	 * @emits enable()
	 */
	async enable(): Promise<boolean> {
		if (await this.setMod('disabled', false)) {
			this.emit('enable');
			return true;
		}

		return false;
	}

	/**
	 * Sets focus to the component
	 * @emits focus()
	 */
	async focus(): Promise<boolean> {
		if (await this.setMod('focused', true)) {
			this.emit('focus');
			return true;
		}

		return false;
	}

	/**
	 * Returns true if the component has all modifiers from specified
	 *
	 * @param mods - list of modifiers (['name', ['name', 'value']])
	 * @param [value] - value of modifiers
	 */
	ifEveryMods(mods: Array<string | string[]>, value?: ModVal): boolean {
		return $C(mods).every((el) => {
			if (Object.isArray(el)) {
				return this.mods[<string>el[0]] === String(el[1]);
			}

			return this.mods[el] === String(value);
		});
	}

	/**
	 * Returns true if the component has at least one modifier from specified
	 *
	 * @param mods - list of modifiers (['name', ['name', 'value']])
	 * @param [value] - value of modifiers
	 */
	ifSomeMod(mods: Array<string | string[]>, value?: ModVal): boolean {
		return $C(mods).some((el) => {
			if (Object.isArray(el)) {
				return this.mods[<string>el[0]] === String(el[1]);
			}

			return this.mods[el] === String(value);
		});
	}

	/**
	 * Sets a new watch property to the specified object
	 *
	 * @param path - path to the property (bla.baz.foo)
	 * @param value
	 * @param [obj]
	 */
	setField(path: string, value: any, obj: object = this): any {
		const
			chunks = path.split('.'),
			isSelf = obj === this,
			isField = isSelf && this.meta.fields[chunks[0]],
			isReady = !this.isBeforeCreate();

		let
			ref = isField ? this.$$data : obj;

		for (let i = 0; i < chunks.length; i++) {
			const
				prop = chunks[i];

			if (chunks.length === i + 1) {
				path = prop;
				continue;
			}

			if (!ref[prop] || typeof ref[prop] !== 'object') {
				const
					val = isNaN(Number(chunks[i + 1])) ? {} : [];

				if (isField && isReady) {
					this.$set(ref, prop, val);

				} else {
					ref[prop] = val;
				}
			}

			ref = ref[prop];
		}

		if (path in ref) {
			ref[path] = value;

		} else {
			if (isField && isReady) {
				this.$set(ref, path, value);

			} else {
				ref[path] = value;
			}
		}

		return value;
	}

	/**
	 * Deletes a watch property from the specified object
	 *
	 * @param path - path to the property (bla.baz.foo)
	 * @param [obj]
	 */
	deleteField(path: string, obj: object = this): boolean {
		const
			chunks = path.split('.'),
			isSelf = obj === this,
			isField = isSelf && this.meta.fields[chunks[0]],
			isReady = !this.isBeforeCreate();

		let
			test = true,
			ref = isField ? this.$$data : obj;

		for (let i = 0; i < chunks.length; i++) {
			const
				prop = chunks[i];

			if (chunks.length === i + 1) {
				path = prop;
				continue;
			}

			if (!ref[prop] || typeof ref[prop] !== 'object') {
				test = false;
				break;
			}

			ref = ref[prop];
		}

		if (test) {
			if (isField && isReady) {
				this.$delete(ref, path);

			} else {
				delete ref[path];
			}

			return true;
		}

		return false;
	}

	/**
	 * Returns a property from the specified object
	 *
	 * @param path - path to the property (bla.baz.foo)
	 * @param [obj]
	 */
	getField(path: string, obj: object = this): any {
		const
			chunks = path.split('.'),
			isSelf = obj === this,
			isField = isSelf && this.meta.fields[chunks[0]];

		let
			res = isField ? this.$$data : obj;

		for (let i = 0; i < chunks.length; i++) {
			if (res == null) {
				return undefined;
			}

			res = res[chunks[i]];
		}

		return res;
	}

	/**
	 * Gets values from the specified object and saves it to the component state
	 * @param [obj]
	 */
	setState(obj: Dictionary | undefined): void {
		$C(obj).forEach((el, key) => {
			const
				p = key.split('.');

			if (p[0] === 'mods') {
				this.setMod(p[0], p.slice(1).join('.'));

			} else if (!Object.fastCompare(el, this.getField(key))) {
				this.setField(key, el);
			}
		});
	}

	/**
	 * Executes the specified callback after beforeDataCreate hook or beforeReady event
	 *
	 * @param cb
	 * @param [params] - additional parameters
	 */
	execCbAtTheRightTime<T>(cb: (this: this) => T, params?: AsyncOpts): CanPromise<T> {
		if (this.isBeforeCreate('beforeDataCreate')) {
			return <any>this.async.promise(new Promise((r) => {
				this.meta.hooks.beforeDataCreate.unshift({fn: () => r(cb.call(this))});
			}), params).catch(stderr);
		}

		if (this.hook === 'beforeDataCreate') {
			return cb.call(this);
		}

		this.beforeReadyListeners++;
		return this.waitStatus('beforeReady', cb, params);
	}

	/**
	 * Accumulates a temporary object and apply it with the specified function
	 *
	 * @param obj
	 * @param key - cache key
	 * @param fn
	 */
	protected accumulateTmpObj(
		obj: Dictionary,
		key: string | symbol,
		fn: (this: this, obj: Dictionary) => void
	): void {
		const
			t = this.tmp,
			k = <any>key,
			tmp = t[k] = t[k] || {};

		Object.assign(
			tmp,
			obj
		);

		const apply = () => {
			fn.call(this, tmp);
			t[k] = undefined;
		};

		this.async.setTimeout(apply, 0.2.second(), {
			label: $$.accumulateTmpObj
		});
	}

	/**
	 * Executes the specified render object
	 *
	 * @param renderObj
	 * @param [ctx] - render context
	 */
	protected execRenderObject(
		renderObj: Dictionary,
		ctx?: RenderContext | [Dictionary] | [Dictionary, RenderContext]
	): VNode {
		let
			instanceCtx,
			renderCtx;

		const
			i = this.instance;

		if (ctx && Object.isArray(ctx)) {
			instanceCtx = ctx[0] || this;
			renderCtx = ctx[1];

			if (instanceCtx !== this) {
				instanceCtx.getBlockClasses = i.getBlockClasses.bind(instanceCtx);
				instanceCtx.getFullBlockName = i.getFullBlockName.bind(instanceCtx);
				instanceCtx.getFullElName = i.getFullElName.bind(instanceCtx);
				instanceCtx.getElClasses = i.getElClasses.bind(instanceCtx);
			}

		} else {
			instanceCtx = this;
			renderCtx = ctx;
		}

		const
			vnode = execRenderObject(renderObj, instanceCtx);

		if (renderCtx) {
			return patchVNode(vnode, instanceCtx, renderCtx);
		}

		return vnode;
	}

	/**
	 * Returns the full name of the specified component
	 *
	 * @param [blockName]
	 * @param [modName]
	 * @param [modValue]
	 */
	protected getFullBlockName(blockName: string = this.componentName, modName?: string, modValue?: any): string {
		return Block.prototype.getFullBlockName.call({blockName}, ...[].slice.call(arguments, 1));
	}

	/**
	 * Returns a full name of the specified element
	 *
	 * @param elName
	 * @param [modName]
	 * @param [modValue]
	 */
	protected getFullElName(elName: string, modName?: string, modValue?: any): string {
		return Block.prototype.getFullElName.apply({blockName: this.componentName}, arguments);
	}

	/**
	 * Searches an element by the specified name from a virtual node
	 *
	 * @param vnode
	 * @param elName
	 * @param [ctx] - component context
	 */
	protected findElFromVNode(vnode: VNode, elName: string, ctx: iBlock = this): VNode | undefined {
		const
			selector = ctx.getFullElName(elName);

		const search = (vnode) => {
			const
				data = vnode.data || {};

			const classes = Object.fromArray([].concat(
				(data.staticClass || '').split(' '),
				data.class || []
			));

			if (classes[selector]) {
				return vnode;
			}

			if (vnode.children) {
				for (let i = 0; i < vnode.children.length; i++) {
					const
						res = search(vnode.children[i]);

					if (res) {
						return res;
					}
				}
			}

			return undefined;
		};

		return search(vnode);
	}

	/**
	 * Sets g-hint for the specified element
	 * @param [pos] - hint position
	 */
	protected setHint(pos: string = 'bottom'): ReadonlyArray<string> {
		return this.getBlockClasses('g-hint', {pos});
	}

	/**
	 * Returns an array of element classes by the specified parameters
	 * @param els - map of elements with map of modifiers ({button: {focused: true}})
	 */
	protected getElClasses(els: Dictionary<ModsTable>): ReadonlyArray<string> {
		const
			key = JSON.stringify(els),
			cache = classesCache.create('els', this.componentId);

		if (cache[key]) {
			return cache[key];
		}

		const
			classes = cache[key] = [this.componentId];

		for (let keys = Object.keys(els), i = 0; i < keys.length; i++) {
			const
				el = keys[i],
				mods = els[el];

			classes.push(
				this.getFullElName(el)
			);

			for (let keys = Object.keys(mods), i = 0; i < keys.length; i++) {
				const
					key = keys[i],
					val = mods[key];

				if (val !== undefined) {
					classes.push(this.getFullElName(el, key, val));
				}
			}
		}

		return Object.freeze(classes);
	}

	/**
	 * Puts the component root element to the stream
	 * @param cb
	 */
	@wait('ready')
	protected async putInStream(cb: (el: Element) => void): Promise<boolean> {
		const
			el = this.$el;

		if (el.clientHeight) {
			cb.call(this, el);
			return false;
		}

		const wrapper = document.createElement('div');
		Object.assign(wrapper.style, {
			'display': 'block',
			'position': 'absolute',
			'top': 0,
			'left': 0,
			'z-index': -1,
			'opacity': 0
		});

		const
			parent = el.parentNode,
			before = el.nextSibling;

		wrapper.appendChild(el);
		document.body.appendChild(wrapper);
		await cb.call(this, el);

		if (parent) {
			if (before) {
				parent.insertBefore(el, before);

			} else {
				parent.appendChild(el);
			}
		}

		wrapper.remove();
		return true;
	}

	/**
	 * Saves the specified settings to the local storage
	 *
	 * @param settings
	 * @param [key] - data key
	 */
	protected async saveSettings<T extends object = Dictionary>(settings: T, key: string = ''): Promise<T> {
		const
			$a = this.async,
			id = `${this.globalName}_${key}`;

		return $a.promise(async () => {
			try {
				await this.storage.set(id, JSON.stringify(settings));
			} catch (_) {}

			return settings;

		}, {
			label: id,
			group: 'saveSettings',
			join: 'replace'
		});
	}

	/**
	 * Loads settings from the local storage
	 * @param [key] - data key
	 */
	protected loadSettings<T extends object = Dictionary>(key: string = ''): Promise<T | undefined> {
		const
			$a = this.async,
			id = `${this.globalName}_${key}`;

		return $a.promise(async () => {
			try {
				const str = await this.storage.get(id);
				return str && JSON.parse(str);
			} catch (_) {}

		}, {
			label: id,
			group: 'loadSettings',
			join: true
		});
	}

	/**
	 * Returns an object with default component fields for saving as local settings
	 * @param [def]
	 */
	protected convertStateToStore(def?: Dictionary | undefined): Dictionary {
		return {...def};
	}

	/**
	 * Saves a store from to local storage
	 */
	@wait({defer: true, label: $$.saveLocalStore})
	protected async saveLocalStore(): Promise<void> {
		if (!this.globalName) {
			return;
		}

		await this.saveSettings(this.convertStateToStore(), '[[STORE]]');
	}

	/**
	 * Loads a store from the local storage
	 */
	protected async loadLocalStore(): Promise<void> {
		if (!this.globalName) {
			return;
		}

		const
			key = $$.pendingLocalStore;

		if (this[key]) {
			return this[key];
		}

		const
			$a = this.async,
			storeWatchers = {group: 'storeWatchers'};

		$a.clearAll(
			storeWatchers
		);

		return this[key] = $a.promise(async () => {
			const
				data = await this.loadSettings('[[STORE]]');

			this.execCbAtTheRightTime(() => {
				const
					stateFields = this.convertStateToStore();

				if (data) {
					this.setState(Object.select(this.convertStateToStore(data), Object.keys(stateFields)));

				} else {
					this.setState(stateFields);
				}

				const sync = () => {
					$a.setTimeout(this.saveLocalStore, 0.2.second(), {
						label: $$.syncLocalStore
					});
				};

				$C(stateFields).forEach((el, key) => {
					const
						p = key.split('.');

					if (p[0] === 'mods') {
						$a.on(this.localEvent, `block.mod.*.${p[0]}.*`, sync, storeWatchers);

					} else {
						this.execCbAfterCreated(() => {
							const watcher = this.$watch(key, (val, oldVal) => {
								if (!Object.fastCompare(val, oldVal)) {
									sync();
								}
							});

							$a.worker(watcher, storeWatchers);
						});
					}
				});
			});

		}, {
			group: 'loadStore',
			join: true
		});
	}

	/**
	 * Returns an object with default component fields for hash
	 * @param [obj]
	 */
	protected convertStateToRouter(obj?: Dictionary | undefined): Dictionary {
		return {...obj};
	}

	/**
	 * Saves the component state a router
	 * @param obj - state object
	 */
	protected async saveStateToRouter(obj: Dictionary): Promise<boolean> {
		obj = this.convertStateToRouter(obj);

		$C(obj).forEach((el, key) => {
			if (el) {
				this[key] = el;
			}
		});

		const
			r = this.$root.router;

		if (!this.isActivated || !r) {
			return false;
		}

		await r.push(null, {
			query: obj
		});

		return true;
	}

	/**
	 * Resets the component router state
	 */
	protected async resetRouterState(): Promise<boolean> {
		$C(this.convertStateToRouter()).forEach((el, key) => this[key] = undefined);

		const
			r = this.$root.router;

		if (!this.isActivated || !r) {
			return false;
		}

		await r.push(null);
		return true;
	}

	/**
	 * Initialized the component state from the location
	 */
	protected initStateFromRouter(): void {
		const
			{async: $a} = this,
			routerWatchers = {group: 'routerWatchers'};

		$a.clearAll(
			routerWatchers
		);

		this.execCbAtTheRightTime(() => {
			const
				p = this.$root.pageInfo,
				stateFields = this.convertStateToRouter();

			if (p && p.query) {
				this.setState(Object.select(this.convertStateToRouter(p.query), Object.keys(stateFields)));

			} else {
				this.setState(stateFields);
			}

			const sync = () => {
				$a.setTimeout(this.saveStateToRouter, 0.2.second(), {
					label: $$.syncRouter
				});
			};

			$C(this.convertStateToRouter()).forEach((el, key) => {
				const
					p = key.split('.');

				if (p[0] === 'mods') {
					$a.on(this.localEvent, `block.mod.*.${p[0]}.*`, sync, routerWatchers);

				} else {
					this.execCbAfterCreated(() => {
						const watcher = this.$watch(key, (val, oldVal) => {
							if (!Object.fastCompare(val, oldVal)) {
								sync();
							}
						});

						$a.worker(watcher, routerWatchers);
					});
				}
			});
		});
	}

	/**
	 * Wraps a handler for delegation of the specified element
	 *
	 * @param elName
	 * @param handler
	 */
	protected delegateElement(elName: string, handler: Function): CanPromise<Function> {
		return this.execCbAfterBlockReady(() => delegate(this.block.getElSelector(elName), handler));
	}

	/**
	 * Returns a link to the closest parent component for the current
	 * @param component - component name or a link to the component constructor
	 */
	protected closest<T extends iBlock = iBlock>(component: string | {new: T}): T | undefined {
		const
			isStr = Object.isString(component);

		let el = this.$parent;
		while (el && (
			isStr ?
				el.componentName !== (<string>component).dasherize() :
				!(el.instance instanceof <any>component)
		)) {
			el = el.$parent;
		}

		return <any>el;
	}

	/**
	 * Returns an instance of Vue component by the specified element
	 *
	 * @param el
	 * @param [filter]
	 */
	protected $<T extends iBlock = iBlock>(el: VueElement<T>, filter?: string): T;

	/**
	 * Returns an instance of Vue component by the specified query
	 *
	 * @param query
	 * @param [filter]
	 */
	protected $<T extends iBlock = iBlock>(query: string, filter?: string): T | undefined;
	protected $<T extends iBlock = iBlock>(query: string | VueElement<T>, filter: string = ''): T | undefined {
		const
			$0 = Object.isString(query) ? document.body.querySelector(query) : query,
			n = $0 && $0.closest(`.i-block-helper${filter}`) as any;

		return n && n.vueComponent;
	}

	/**
	 * Binds a modifier to the specified field
	 *
	 * @param mod
	 * @param field
	 * @param [converter] - converter function
	 * @param [opts] - watch options
	 */
	protected bindModTo<T = this>(
		mod: string,
		field: string,
		converter: ((value: any, ctx: T) => any) | WatchOptions = Boolean,
		opts?: WatchOptions
	): void {
		mod = mod.camelize(false);

		if (!Object.isFunction(converter)) {
			opts = converter;
			converter = Boolean;
		}

		const
			fn = <Function>converter;

		const setWatcher = () => {
			this.$watch(field, (val) => {
				this.setMod(mod, fn(val, this));
			}, opts);
		};

		if (this.isBeforeCreate()) {
			const sync = this.syncModCache[mod] = () => {
				this.mods[mod] = String(fn(this.getField(field), this));
			};

			if (this.hook !== 'beforeDataCreate') {
				this.meta.hooks.beforeDataCreate.push({
					fn: sync
				});

			} else {
				sync();
			}

			setWatcher();

		} else if (statuses[this.componentStatus] >= 1) {
			setWatcher();
		}
	}

	/**
	 * Returns if the specified label:
	 *   2 -> already exists in the cache;
	 *   1 -> just written in the cache;
	 *   0 -> doesn't exist in the cache.
	 *
	 * @param label
	 * @param [value] - label value (will saved in the cache only if true)
	 */
	protected ifOnce(label: any, value: boolean = false): 0 | 1 | 2 {
		if (this.ifOnceStore[label]) {
			return 2;
		}

		if (value) {
			return this.ifOnceStore[label] = 1;
		}

		return 0;
	}

	/**
	 * Wrapper for $nextTick
	 *
	 * @see Async.promise
	 * @param [params]
	 */
	protected nextTick(params?: AsyncOpts): Promise<void> {
		return this.async.promise(this.$nextTick(), params);
	}

	/**
	 * Waits until the specified reference won't be available
	 * and returns it
	 *
	 * @see Async.wait
	 * @param ref
	 * @param [params]
	 */
	protected async waitRef<T = iBlock | Element | iBlock[] | Element[]>(ref: string, params?: AsyncOpts): Promise<T> {
		await this.async.wait(() => this.$refs[ref], params);
		const link = <any>this.$refs[ref];
		return link.vueComponent ? link.vueComponent : link;
	}

	/**
	 * Sends an analytic event with the specified parameters
	 *
	 * @param event - event name
	 * @param [details] - event details
	 */
	protected sendAnalyticsEvent(event: string, details: Dictionary = {}): void {
		this.async.setImmediate(() => analytics.send(event, details), {
			label: $$.sendAnalyticsEvent
		});
	}

	/**
	 * Initializes core component API
	 */
	@hook('beforeRuntime')
	protected initBaseAPI(): void {
		// @ts-ignore
		this.linksCache = {};

		// @ts-ignore
		this.syncLinkCache = {};

		// @ts-ignore
		this.syncModCache = {};

		const
			i = this.instance;

		this.link = i.link.bind(this);
		this.createWatchObject = i.createWatchObject.bind(this);
		this.isBeforeCreate = i.isBeforeCreate.bind(this);
		this.execCbAfterCreated = i.execCbAfterCreated.bind(this);
		this.execCbAfterBlockReady = i.execCbAfterBlockReady.bind(this);
		this.execCbAtTheRightTime = i.execCbAtTheRightTime.bind(this);
		this.bindModTo = i.bindModTo.bind(this);
		this.getField = i.getField.bind(this);
		this.setField = i.setField.bind(this);
		this.deleteField = i.deleteField.bind(this);
		this.convertStateToStore = i.convertStateToStore.bind(this);
		this.loadLocalStore = i.loadLocalStore.bind(this);
		this.convertStateToRouter = i.convertStateToRouter.bind(this);
		this.initStateFromRouter = i.initStateFromRouter.bind(this);
		this.setState = i.setState.bind(this);

		Object.defineProperties(this, {
			refs: {
				// tslint:disable-next-line
				get: i['refsGetter']
			}
		});

		const
			{$watch} = this;

		if ($watch) {
			// @ts-ignore
			this.$watch = (...args) => this.execCbAfterCreated(() => $watch.apply(this, args));
		}
	}

	/**
	 * Synchronizes component link values with linked values
	 *
	 * @param [name] - link name or [linked] | [linked, link]
	 * @param [value] - additional value for sync
	 */
	protected syncLinks(name?: string | [string] | [string, string], value?: any): void {
		const
			linkName = <string | undefined>(Object.isString(<any>name) ? name : name && name[1]),
			fieldName = Object.isArray(<any>name) ? (<string[]>name)[0] : undefined;

		const
			cache = this.syncLinkCache,
			sync = (el, key) => (!fieldName || key === fieldName) && el.sync(value);

		if (linkName) {
			$C(cache[linkName]).forEach(sync);

		} else {
			$C(cache).forEach((el) => $C(el).forEach(sync));
		}
	}

	/**
	 * Sets a link for the specified field
	 * @param [watchParamsOrWrapper]
	 */
	protected link(watchParamsOrWrapper?: WatchOptions | LinkWrapper): any;

	/**
	 * Sets a link for the specified field
	 *
	 * @param watchParams
	 * @param [wrapper]
	 */
	protected link(watchParams: WatchOptions, wrapper?: LinkWrapper): any;

	/**
	 * Sets a link for the specified field
	 *
	 * @param field
	 * @param [watchParamsOrWrapper]
	 */
	protected link(field: string, watchParamsOrWrapper?: WatchOptions | LinkWrapper): any;

	/**
	 * Sets a link for the specified field
	 *
	 * @param field
	 * @param watchParams
	 * @param [wrapper]
	 */
	protected link(field: string, watchParams: WatchOptions, wrapper?: LinkWrapper): any;
	protected link(
		field?: string | WatchOptions | LinkWrapper,
		watchParams?: WatchOptions | LinkWrapper,
		wrapper?: LinkWrapper
	): any {
		const
			path = this.$activeField,
			cache = this.syncLinkCache;

		if (!field || !Object.isString(field)) {
			wrapper = <LinkWrapper>watchParams;
			watchParams = <WatchOptions>field;
			field = `${path.replace(/Store$/, '')}Prop`;
		}

		if (watchParams && Object.isFunction(watchParams)) {
			wrapper = watchParams;
			watchParams = undefined;
		}

		if (!(path in this.linksCache)) {
			this.linksCache[path] = {};
			this.$watch(field, (val, oldVal) => {
				if (!Object.fastCompare(val, oldVal)) {
					this.setField(path, wrapper ? wrapper.call(this, val, oldVal) : val);
				}
			}, <WatchOptions>watchParams);

			const sync = (val?) => {
				val = val || this.getField(<string>field);

				const
					res = wrapper ? wrapper.call(this, val) : val;

				this.setField(path, res);
				return res;
			};

			// tslint:disable-next-line:prefer-object-spread
			cache[field] = Object.assign(cache[field] || {}, {
				[path]: {
					path,
					sync
				}
			});

			if (this.isBeforeCreate('beforeDataCreate')) {
				const
					name = '[[SYNC]]',
					hooks = this.meta.hooks.beforeDataCreate;

				let
					pos = 0;

				for (let i = 0; i < hooks.length; i++) {
					if (hooks[i].name === name) {
						pos = i + 1;
					}
				}

				hooks.splice(pos, 0, {fn: sync, name});
				return;
			}

			return sync();
		}
	}

	/**
	 * Creates an object with linked fields
	 *
	 * @param path - property path
	 * @param fields
	 */
	protected createWatchObject(
		path: string,
		fields: WatchObjectFields
	): Dictionary;

	/**
	 * @param path - property path
	 * @param watchParams
	 * @param fields
	 */
	protected createWatchObject(
		path: string,
		watchParams: WatchOptions,
		fields: WatchObjectFields
	): Dictionary;

	protected createWatchObject(
		path: string,
		watchParams: WatchOptions | WatchObjectFields,
		fields?: WatchObjectFields
	): Dictionary {
		if (Object.isArray(watchParams)) {
			fields = watchParams;
			watchParams = {};
		}

		const
			{linksCache, syncLinkCache} = this;

		// tslint:disable-next-line
		if (path) {
			path = [this.$activeField, path].join('.');

		} else {
			path = this.$activeField;
		}

		const
			short = path.split('.').slice(1),
			obj = {};

		if (short.length) {
			$C(obj).set({}, short);
		}

		const
			map = $C(obj).get(short);

		for (let i = 0; i < (<WatchObjectFields>fields).length; i++) {
			const
				el = (<WatchObjectFields>fields)[i];

			if (Object.isArray(el)) {
				let
					wrapper,
					field;

				if (el.length === 3) {
					field = el[1];
					wrapper = el[2];

				} else if (Object.isFunction(el[1])) {
					field = el[0];
					wrapper = el[1];

				} else {
					field = el[1];
				}

				const
					l = [path, el[0]].join('.');

				if (!$C(linksCache).get(l)) {
					$C(linksCache).set(true, l);
					this.$watch(field, (val, oldVal) => {
						if (!Object.fastCompare(val, oldVal)) {
							this.setField(l, wrapper ? wrapper.call(this, val, oldVal) : val);
						}
					}, <WatchOptions>watchParams);

					const sync = (val?) => {
						val = val || this.getField(field);
						return wrapper ? wrapper.call(this, val) : val;
					};

					// tslint:disable-next-line:prefer-object-spread
					syncLinkCache[field] = Object.assign(syncLinkCache[field] || {}, {
						[l]: {
							path: l,
							sync: (val?) => this.setField(l, sync(val))
						}
					});

					map[el[0]] = sync();
				}

			} else {
				const
					l = [path, el].join('.');

				if (!$C(linksCache).get(l)) {
					$C(linksCache).set(true, l);
					this.$watch(el, (val, oldVal) => {
						if (!Object.fastCompare(val, oldVal)) {
							this.setField(l, val);
						}
					}, <WatchOptions>watchParams);

					// tslint:disable-next-line:prefer-object-spread
					syncLinkCache[el] = Object.assign(syncLinkCache[el] || {}, {
						[l]: {
							path: l,
							sync: (val?) => this.setField(l, val || this.getField(el))
						}
					});

					map[el] = this.getField(el);
				}
			}
		}

		return obj;
	}

	/**
	 * Adds a component to the render queue
	 *
	 * @param id - task id
	 * @param [group] - task group
	 */
	protected regAsyncComponent(id: any, group: string = 'asyncComponents'): string {
		let
			filter;

		if (Object.isFunction(id)) {
			const
				v = id();

			if (Object.isObject(v)) {
				id = v.id;
				filter = v.filter;

			} else {
				id = v;
			}

		} else if (Object.isObject(id)) {
			filter = id.filter;
			id = id.id;
		}

		if (!this[group][id]) {
			this.asyncLoading = true;
			const fn = this.async.proxy(() => {
				if (filter && !filter(id)) {
					return false;
				}

				this.asyncCounter++;
				this.asyncQueue.delete(fn);
				this.$set(this[group], id, true);
				return true;

			}, {group});

			this.asyncQueue.add(fn);
			queue.add(fn);
		}

		return id;
	}

	/**
	 * Adds a component to the background render queue
	 * @param id - task id
	 */
	protected regAsyncBackComponent(id: any): string {
		return this.regAsyncComponent(id, 'asyncBackComponents');
	}

	/**
	 * Synchronization for the asyncCounter field
	 * @param value
	 */
	@watch({field: 'asyncCounter', immediate: true})
	protected syncAsyncCounterWatcher(value: number): void {
		const disableAsync = () => {
			this.asyncLoading = false;
		};

		this.async.setTimeout(disableAsync, 0.2.second(), {
			label: $$.asyncLoading
		});

		if (value && this.$parent && 'asyncCounter' in this.$parent) {
			this.$parent.asyncCounter++;
		}
	}

	/**
	 * Synchronization for the stage field
	 *
	 * @param value
	 * @param oldValue
	 */
	@watch({field: 'stage', immediate: true})
	protected syncStageWatcher(value: string, oldValue: string | undefined): void {
		this.emit('stageChange', value, oldValue);
	}

	/**
	 * Returns an object with classes for elements of an another component
	 * @param classes - additional classes ({baseElementName: newElementName})
	 */
	protected provideClasses(classes?: Classes): Readonly<Dictionary<string>> {
		const
			key = JSON.stringify(classes),
			cache = classesCache.create('base');

		if (cache[key]) {
			return cache[key];
		}

		const
			map = cache[key] = {};

		if (classes) {
			const
				keys = Object.keys(classes);

			for (let i = 0; i < keys.length; i++) {
				const
					key = keys[i];

				let
					el = classes[key];

				if (el === true) {
					el = key;

				} else if (Object.isArray(el)) {
					el = el.slice();
					for (let i = 0; i < el.length; i++) {
						if (el[i] === true) {
							el[i] = key;
						}
					}
				}

				map[key.dasherize()] = this.getFullElName.apply(this, (<any[]>[]).concat(el));
			}
		}

		return Object.freeze(map);
	}

	/**
	 * Returns an object with base component modifiers
	 * @param mods - additional modifiers ({modifier: {currentValue: value}} || {modifier: value})
	 */
	protected provideMods(mods?: Dictionary<ModVal | Dictionary<ModVal>>): Readonly<ModsNTable> {
		const
			key = JSON.stringify(this.baseMods) + JSON.stringify(mods);

		if (modsCache[key]) {
			return modsCache[key];
		}

		const
			map = modsCache[key] = {...this.baseMods};

		if (mods) {
			const
				keys = Object.keys(mods);

			for (let i = 0; i < keys.length; i++) {
				const
					key = keys[i],
					mod = key.dasherize();

				let
					el = <any>mods[key];

				if (!Object.isObject(el)) {
					el = {default: el};
				}

				// tslint:disable-next-line
				if (!(key in mods) || el[key] === undefined) {
					map[mod] = el[Object.keys(el)[0]];

				} else {
					map[mod] = el[key];
				}
			}
		}

		return Object.freeze(map);
	}

	/**
	 * Saves to cache the specified literal and returns returns it
	 * @param literal
	 */
	protected memoizeLiteral<T extends Dictionary | any[]>(literal: T): T extends any[] ? ReadonlyArray<T> : Readonly<T> {
		const key = JSON.stringify(literal);
		return modsCache[key] = modsCache[key] || Object.freeze(literal);
	}

	/**
	 * Initializes component instance
	 */
	@hook('mounted')
	protected initBlockInstance(): void {
		if (this.block) {
			const
				{node} = this.block;

			if (node === this.$el) {
				return;
			}

			if (node && node.vueComponent === this) {
				delete node.vueComponent;
			}
		}

		this.block = new Block(this);
		this.localEvent.emit('block.ready');
	}

	/**
	 * Initializes modifiers event listeners
	 */
	@hook('beforeCreate')
	protected initModEvents(): void {
		const
			{async: $a, localEvent: $e} = this;

		$e.on('block.mod.set.**', (e) => {
			const
				k = e.name,
				v = e.value,
				w = this.watchModsStore;

			this
				.mods[k] = v;

			if (k in w && w[k] !== v) {
				delete w[k];
				this.$set(w, k, v);
			}

			this.emit(`mod-set-${k}-${v}`, e);
		});

		$e.on('block.mod.remove.**', (e) => {
			if (e.reason === 'removeMod') {
				const
					k = e.name,
					w = this.watchModsStore;

				this
					.mods[k] = undefined;

				if (k in w && w[k]) {
					delete w[k];
					this.$set(w, k, undefined);
				}

				this.emit(`mod-remove-${k}-${e.value}`, e);
			}
		});

		$e.on('block.mod.*.disabled.*', (e) => {
			if (e.value === 'false' || e.type === 'remove') {
				$a.off({group: 'blockOnDisable'});

			} else {
				const handler = (e) => {
					e.preventDefault();
					e.stopImmediatePropagation();
				};

				$a.on(this.$el, 'click mousedown touchstart keydown input change scroll', handler, {
					group: 'blockOnDisable',
					options: {
						capture: true
					}
				});
			}
		});
	}

	/**
	 * Component created
	 */
	protected created(): void {
		return undefined;
	}

	/**
	 * Component mounted to DOM
	 */
	protected mounted(): void {
		return undefined;
	}

	/**
	 * Component activated
	 * (for keep-alive)
	 */
	protected async activated(): Promise<void> {
		if (this.isActivated) {
			return;
		}

		this.componentStatus = 'loading';

		if (this.needReInit) {
			await this.initLoad();

		} else {
			this.componentStatus = 'ready';
		}

		this.isActivated = true;
		await this.forceUpdate();
	}

	/**
	 * Component deactivated
	 * (for keep-alive)
	 */
	protected deactivated(): void {
		this.async
			.clearImmediate()
			.clearTimeout()
			.cancelIdleCallback();

		this.async
			.cancelAnimationFrame()
			.cancelRequest()
			.terminateWorker()
			.cancelProxy();

		this.componentStatus = 'inactive';
		this.isActivated = false;
	}

	/**
	 * Component before destroy
	 */
	protected beforeDestroy(): void {
		this.componentStatus = 'destroyed';
		this.async.clearAll();
		this.localEvent.removeAllListeners();

		$C(this.asyncQueue).forEach((el) => {
			queue.delete(el);
			backQueue.delete(el);
		});

		delete classesCache.dict.els[this.componentId];
	}

	/**
	 * Returns true if the component hook is equal one of "before" hooks
	 * @param [skip] - name of a skipped hook
	 */
	protected isBeforeCreate(...skip: Hooks[]): boolean {
		const
			hooks = {beforeRuntime: true, beforeCreate: true, beforeDataCreate: true};

		for (let i = 0; i < skip.length; i++) {
			hooks[skip[i]] = false;
		}

		return Boolean(hooks[this.hook]);
	}

	/**
	 * Executes the specified callback after created hook and returns the result
	 *
	 * @param cb
	 * @param [params] - additional parameters
	 */
	protected execCbAfterCreated<T>(cb: (this: this) => T, params?: AsyncOpts): CanPromise<T> {
		if (this.isBeforeCreate()) {
			return <any>this.async.promise(new Promise((r) => {
				this.meta.hooks.created.unshift({fn: () => r(cb.call(this))});
			}), params).catch(stderr);
		}

		return cb.call(this);
	}

	/**
	 * Executes the specified callback after block.ready event and returns the result
	 *
	 * @param cb
	 * @param [params] - additional parameters
	 */
	protected execCbAfterBlockReady<T>(cb: (this: this) => T, params?: AsyncOpts): CanPromise<T> {
		if (this.block) {
			return cb.call(this);
		}

		return <any>this.async.promise(new Promise((r) => {
			this.localEvent.once('block.ready', () => r(cb.call(this)));
		}), params).catch(stderr);
	}
}

/**
 * Hack for i-component decorators
 */
export abstract class iBlockDecorator extends iBlock {
	public readonly h!: typeof helpers;
	public readonly b!: typeof browser;
	public readonly t!: typeof i18n;

	public readonly meta!: ComponentMeta;
	public readonly linksCache!: Dictionary<Dictionary>;
	public readonly syncLinkCache!: SyncLinkCache;
	public readonly $attrs!: Dictionary<string>;

	public readonly async!: Async<this>;
	public readonly block!: Block;
	public readonly localEvent!: EventEmitter;

	public abstract link(watchParamsOrWrapper?: WatchOptions | LinkWrapper): any;
	public abstract link(watchParams: WatchOptions, wrapper?: LinkWrapper): any;
	public abstract link(field: string, watchParamsOrWrapper?: WatchOptions | LinkWrapper): any;
	public abstract link(field: string, watchParams: WatchOptions, wrapper?: LinkWrapper): any;

	public abstract createWatchObject(
		path: string,
		fields: WatchObjectFields
	): Dictionary;

	public abstract createWatchObject(
		path: string,
		watchParams: WatchOptions,
		fields: WatchObjectFields
	): Dictionary;

	public abstract bindModTo<T = this>(
		mod: string,
		field: string,
		converter: ((value: any, ctx: T) => any) | WatchOptions,
		opts?: WatchOptions
	): void;

	// @ts-ignore
	public $watch<T = any>(
		exprOrFn: string | ((this: this) => string),
		cb: (this: this, n: T, o: T) => void,
		opts?: WatchOptions
	): (() => void);

	// @ts-ignore
	public $watch<T = any>(
		exprOrFn: string | ((this: this) => string),
		opts: WatchOptionsWithHandler<T>
	): (() => void);

	// tslint:disable-next-line
	public $watch() {}
}

function defaultI18n(): string {
	return this.$root.i18n.apply(this.$root, arguments);
}
