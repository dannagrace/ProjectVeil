declare module "cc" {
  export namespace _decorator {
    function ccclass(name: string): ClassDecorator;
    function property(target: object, propertyKey: string | symbol): void;
    function property(type: unknown): PropertyDecorator;
  }

  export class Component {
    node: Node;
    scheduleOnce(callback: () => void, delay?: number): void;
    unscheduleAllCallbacks(): void;
  }

  export class Node {
    static EventType: {
      TOUCH_START: string;
      TOUCH_END: string;
      MOUSE_DOWN: string;
      MOUSE_UP: string;
    };

    name: string;
    parent: Node | null;
    active: boolean;
    layer: number;
    position: Vec3;

    constructor(name?: string);

    addComponent<T>(type: new () => T): T;
    getComponent<T>(type: new () => T): T | null;
    removeComponent<T>(component: T): void;
    getChildByName(name: string): Node | null;
    destroy(): void;
    setPosition(x: number, y: number, z?: number): void;
    setRotationFromEuler(x: number, y: number, z: number): void;
    setScale(x: number, y?: number, z?: number): void;
    on(type: string, callback: (...args: unknown[]) => void, target?: unknown): void;
    off(type: string, callback?: (...args: unknown[]) => void, target?: unknown): void;
  }

  export class Canvas extends Component {}

  export class Camera extends Component {
    visibility: number;
    orthoHeight: number;
    near: number;
    far: number;
  }

  export class UITransform extends Component {
    width: number;
    height: number;
    setContentSize(width: number, height: number): void;
    convertToNodeSpaceAR(worldPoint: Vec3): Vec3;
  }

  export class Vec3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
  }

  export function v3(x?: number, y?: number, z?: number): Vec3;

  export class EventTouch {
    getUILocation(): {
      x: number;
      y: number;
    };
  }

  export class EventMouse {
    getUILocation(): {
      x: number;
      y: number;
    };
  }

  export class UIOpacity extends Component {
    opacity: number;
  }

  export class SpriteFrame {
    name: string;
    texture: unknown;
    static createWithImage(imageAsset: unknown): SpriteFrame;
  }

  export class ImageAsset {
    name: string;
  }

  export class Sprite extends Component {
    spriteFrame: SpriteFrame | null;
    color: Color;
  }

  export class Color {
    constructor(r?: number, g?: number, b?: number, a?: number);
    r: number;
    g: number;
    b: number;
    a: number;
  }

  export class Graphics extends Component {
    fillColor: Color;
    strokeColor: Color;
    lineWidth: number;
    clear(): void;
    circle(x: number, y: number, r: number): void;
    roundRect(x: number, y: number, w: number, h: number, r: number): void;
    fill(): void;
    stroke(): void;
  }

  export class Label extends Component {
    string: string;
    fontSize: number;
    lineHeight: number;
    overflow: number;
    horizontalAlign: number;
    verticalAlign: number;
    enableWrapText: boolean;
    color: Color;
  }

  export class TiledMap extends Component {
    getLayer(name: string): TiledLayer | null;
  }

  export class TiledLayer extends Component {
    getLayerSize(): {
      width: number;
      height: number;
    };
    setTileGIDAt(gid: number, x: number, y: number): void;
  }

  export class Animation extends Component {
    play(name?: string): void;
    crossFade(name: string, duration: number): void;
  }

  export namespace sp {
    class Skeleton extends Component {
      animation: string;
      setAnimation(trackIndex: number, name: string, loop: boolean): void;
    }
  }

  export const view: {
    getVisibleSize(): {
      width: number;
      height: number;
    };
  };

  export const sys: {
    localStorage: Storage;
  };

  export const Input: {
    EventType: {
      TOUCH_START: string;
      TOUCH_END: string;
      MOUSE_DOWN: string;
      MOUSE_UP: string;
    };
  };

  export const input: {
    on(type: string, callback: (...args: unknown[]) => void, target?: unknown): void;
    off(type: string, callback?: (...args: unknown[]) => void, target?: unknown): void;
  };

  export const resources: {
    load<T>(
      path: string,
      type: new (...args: never[]) => T,
      callback: (err: Error | null, asset: T) => void
    ): void;
  };

  export const Layers: {
    Enum: {
      DEFAULT: number;
      UI_2D: number;
    };
  };
}
