const noop = () => undefined;

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    }
  };
}

export const _decorator = {
  ccclass() {
    return (target) => target;
  },
  property() {
    return noop;
  }
};

export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

export function v3(x = 0, y = 0, z = 0) {
  return new Vec3(x, y, z);
}

export class Component {
  constructor() {
    this.node = new Node("ComponentNode");
  }

  scheduleOnce(callback) {
    callback();
  }

  unscheduleAllCallbacks() {}
}

export class Node {
  static EventType = {
    TOUCH_START: "touch-start",
    TOUCH_END: "touch-end",
    MOUSE_DOWN: "mouse-down",
    MOUSE_UP: "mouse-up"
  };

  constructor(name = "") {
    this.name = name;
    this._parent = null;
    this.active = true;
    this.layer = 0;
    this.position = new Vec3();
    this.children = [];
    this.components = new Map();
    this.listeners = new Map();
  }

  addComponent(Type) {
    const component = new Type();
    if (component && typeof component === "object") {
      component.node = this;
    }
    this.components.set(Type, component);
    return component;
  }

  getComponent(Type) {
    return this.components.get(Type) ?? null;
  }

  get parent() {
    return this._parent;
  }

  set parent(value) {
    if (this._parent === value) {
      return;
    }

    if (this._parent) {
      this._parent.children = this._parent.children.filter((child) => child !== this);
    }

    this._parent = value;

    if (value && !value.children.includes(this)) {
      value.children.push(this);
    }
  }

  removeComponent(component) {
    for (const [Type, value] of this.components.entries()) {
      if (value === component) {
        this.components.delete(Type);
      }
    }
  }

  getChildByName(name) {
    return this.children.find((child) => child.name === name) ?? null;
  }

  addChild(child) {
    child.parent = this;
  }

  destroy() {
    this.active = false;
    this.children.length = 0;
    this.components.clear();
    this.listeners.clear();
  }

  setPosition(x, y, z = 0) {
    this.position = new Vec3(x, y, z);
  }

  setRotationFromEuler() {}

  setScale(x, y = x, z = y) {
    this.scale = new Vec3(x, y, z);
  }

  on(type, callback, target) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ callback, target });
    this.listeners.set(type, listeners);
  }

  off(type, callback, target) {
    if (!this.listeners.has(type)) {
      return;
    }

    if (!callback) {
      this.listeners.delete(type);
      return;
    }

    this.listeners.set(
      type,
      this.listeners.get(type).filter((listener) => listener.callback !== callback || listener.target !== target)
    );
  }

  emit(type, ...args) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener.callback.apply(listener.target ?? this, args);
    }
  }
}

export class Canvas extends Component {}

export class Camera extends Component {
  constructor() {
    super();
    this.visibility = 0;
    this.orthoHeight = 0;
    this.near = 0;
    this.far = 0;
  }
}

export class UITransform extends Component {
  constructor() {
    super();
    this.width = 0;
    this.height = 0;
  }

  setContentSize(width, height) {
    this.width = width;
    this.height = height;
  }

  convertToNodeSpaceAR(worldPoint) {
    return worldPoint;
  }
}

export class EventTouch {
  getUILocation() {
    return { x: 0, y: 0 };
  }
}

export class EventMouse {
  getUILocation() {
    return { x: 0, y: 0 };
  }
}

export class UIOpacity extends Component {
  constructor() {
    super();
    this.opacity = 255;
  }
}

export class ImageAsset {
  constructor() {
    this.name = "";
  }
}

export class SpriteFrame {
  constructor() {
    this.name = "";
    this.texture = null;
  }

  static createWithImage(imageAsset) {
    const frame = new SpriteFrame();
    frame.texture = imageAsset;
    return frame;
  }
}

export class AudioClip {
  constructor() {
    this.name = "";
  }
}

export class AudioSource extends Component {
  constructor() {
    super();
    this.clip = null;
    this.loop = false;
    this.volume = 1;
  }

  play() {}

  stop() {}

  playOneShot() {}
}

export class Color {
  constructor(r = 0, g = 0, b = 0, a = 255) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }
}

export class Sprite extends Component {
  constructor() {
    super();
    this.spriteFrame = null;
    this.color = new Color();
  }
}

export class Graphics extends Component {
  constructor() {
    super();
    this.fillColor = new Color();
    this.strokeColor = new Color();
    this.lineWidth = 1;
  }

  clear() {}

  circle() {}

  rect() {}

  roundRect() {}

  fill() {}

  stroke() {}
}

export class Label extends Component {
  constructor() {
    super();
    this.string = "";
    this.fontSize = 0;
    this.lineHeight = 0;
    this.overflow = 0;
    this.horizontalAlign = 0;
    this.verticalAlign = 0;
    this.enableWrapText = false;
    this.color = new Color();
  }
}

export class TiledMap extends Component {
  getLayer() {
    return null;
  }
}

export class TiledLayer extends Component {
  getLayerSize() {
    return { width: 0, height: 0 };
  }

  setTileGIDAt() {}
}

export class Animation extends Component {
  play() {}

  crossFade() {}
}

export const sp = {
  Skeleton: class Skeleton extends Component {
    constructor() {
      super();
      this.animation = "";
    }

    setAnimation(_trackIndex, name) {
      this.animation = name;
    }
  }
};

export const view = {
  getVisibleSize() {
    return { width: 1280, height: 720 };
  }
};

export const sys = {
  localStorage: globalThis.__cocosLocalStorage ?? createMemoryStorage()
};

export const Input = {
  EventType: {
    TOUCH_START: "touch-start",
    TOUCH_END: "touch-end",
    MOUSE_DOWN: "mouse-down",
    MOUSE_UP: "mouse-up"
  }
};

export const input = {
  on() {},
  off() {}
};

export const resources = {
  load(_path, Type, callback) {
    callback(null, new Type());
  }
};

export const Layers = {
  Enum: {
    DEFAULT: 1,
    UI_2D: 2
  }
};

export class Tween {
  constructor(target) {
    this.target = target;
  }

  to() {
    return this;
  }

  delay() {
    return this;
  }

  start() {
    return this;
  }

  static stopAllByTarget() {}
}

export function tween(target) {
  return new Tween(target);
}
