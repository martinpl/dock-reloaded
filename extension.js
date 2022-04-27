const { GObject, GLib, Meta, Shell, Clutter } = imports.gi;
const Main = imports.ui.main;
const Dash = imports.ui.dash;
const AppFavorites = imports.ui.appFavorites;
const Layout = imports.ui.layout;

var Dock = GObject.registerClass(
	class Dock extends Dash.Dash {
		_init() {
			super._init();
			Main.layoutManager.addTopChrome(this);
			this._showAppsIcon.showLabel = DockItemContainer.prototype.showLabel;
			this.showAppsButton.connect("button-release-event", this._showAppsToggle.bind());
			this.set_track_hover(true);
			this.set_reactive(true);
			this.hide();

			this._monitor = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
			this.set_width(this._monitor.width);
			this.set_style_class_name("dock");

			this._dragging = false;
			Main.overview.connect("item-drag-begin", () => {
				this._dragging = true;
			});
			Main.overview.connect("item-drag-end", () => {
				this._dragging = false;
			});

			this._pressureBarrier = new Layout.PressureBarrier(250, 1000, Shell.ActionMode.NORMAL);
			this._pressureBarrier.addBarrier(this._createBarrier());
			this._pressureBarrier.connect("trigger", () => this._revealDock(true));
		}

		_showAppsToggle() {
			if (Main.overview.visible) {
				Main.overview.hide();
			} else {
				Main.overview.showApps();
			}
		}

		_revealDock() {
			this.show();

			GLib.timeout_add(GLib.PRIORITY_DEFAULT, 550, () => {
				if (!this._dragging && !this.get_hover() && global.display.get_focus_window()) {
					this.hide();
					return GLib.SOURCE_REMOVE;
				} else {
					return GLib.SOURCE_CONTINUE;
				}
			});
		}

		_createBarrier() {
			return new Meta.Barrier({
				display: global.display,
				x1: this._monitor.x,
				x2: this._monitor.x + this._monitor.width,
				y1: this._monitor.y,
				y2: this._monitor.y,
				directions: Meta.BarrierDirection.POSITIVE_Y,
			});
		}

		_createAppItem(app) {
			let appIcon = new Dash.DashIcon(app);

			appIcon.connect("menu-state-changed", (o, opened) => {
				this._itemMenuStateChanged(item, opened);
			});

			let item = new DockItemContainer();
			item.setChild(appIcon);

			appIcon.label_actor = null;
			item.setLabelText(app.get_name());

			appIcon.icon.setIconSize(this.iconSize);
			this._hookUpLabel(item, appIcon);

			return item;
		}

		// Copycat from GS without running apps and separator
		_redisplay() {
			let favorites = AppFavorites.getAppFavorites().getFavoriteMap();
			let children = this._box.get_children().filter((actor) => {
				return actor.child && actor.child._delegate && actor.child._delegate.app;
			});
			let oldApps = children.map((actor) => actor.child._delegate.app);
			let newApps = [];

			for (let id in favorites) newApps.push(favorites[id]);

			let addedItems = [];
			let removedActors = [];

			let newIndex = 0;
			let oldIndex = 0;
			while (newIndex < newApps.length || oldIndex < oldApps.length) {
				let oldApp = oldApps.length > oldIndex ? oldApps[oldIndex] : null;
				let newApp = newApps.length > newIndex ? newApps[newIndex] : null;

				if (oldApp == newApp) {
					oldIndex++;
					newIndex++;
					continue;
				}

				if (oldApp && !newApps.includes(oldApp)) {
					removedActors.push(children[oldIndex]);
					oldIndex++;
					continue;
				}

				if (newApp && !oldApps.includes(newApp)) {
					addedItems.push({
						app: newApp,
						item: this._createAppItem(newApp),
						pos: newIndex,
					});
					newIndex++;
					continue;
				}

				let nextApp = newApps.length > newIndex + 1 ? newApps[newIndex + 1] : null;
				let insertHere = nextApp && nextApp == oldApp;
				let alreadyRemoved = removedActors.reduce((result, actor) => {
					let removedApp = actor.child._delegate.app;
					return result || removedApp == newApp;
				}, false);

				if (insertHere || alreadyRemoved) {
					let newItem = this._createAppItem(newApp);
					addedItems.push({
						app: newApp,
						item: newItem,
						pos: newIndex + removedActors.length,
					});
					newIndex++;
				} else {
					removedActors.push(children[oldIndex]);
					oldIndex++;
				}
			}

			for (let i = 0; i < addedItems.length; i++) {
				this._box.insert_child_at_index(addedItems[i].item, addedItems[i].pos);
			}

			for (let i = 0; i < removedActors.length; i++) {
				let item = removedActors[i];

				if (Main.overview.visible && !Main.overview.animationInProgress)
					item.animateOutAndDestroy();
				else item.destroy();
			}

			this._adjustIconSize();

			let animate =
				this._shownInitially && Main.overview.visible && !Main.overview.animationInProgress;

			if (!this._shownInitially) this._shownInitially = true;

			for (let i = 0; i < addedItems.length; i++) addedItems[i].item.show(animate);

			this._box.queue_relayout();
		}
	}
);

var DockItemContainer = GObject.registerClass(
	class DockItemContainer extends Dash.DashItemContainer {
		showLabel() {
			if (!this._labelText) return;

			this.label.set_text(this._labelText);
			this.label.opacity = 0;
			this.label.show();

			let [stageX, stageY] = this.get_transformed_position();

			const itemWidth = this.allocation.get_width();

			const labelWidth = this.label.get_width();
			const xOffset = Math.floor((itemWidth - labelWidth) / 2);
			const x = Math.clamp(stageX + xOffset, 0, global.stage.width - labelWidth);

			const y = this.get_height() + stageY;

			this.label.set_position(x, y);
			this.label.ease({
				opacity: 255,
				duration: Dash.DASH_ITEM_LABEL_SHOW_TIME,
				mode: Clutter.AnimationMode.EASE_OUT_QUAD,
			});
		}
	}
);

class Extension {
	enable() {
		Main.overview.dash.hide();
		this.dock = new Dock();
	}

	disable() {
		this.dock.destory_all_children();
		this.dock.destroy();
		Main.overview.dash.show();
		// TODO: Disconnects
	}
}

function init() {
	return new Extension();
}
