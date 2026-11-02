// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { chartTemplate } from "../content/chart";
const mock = vi.hoisted(() => ({ init: vi.fn(), instances: [] as any[] }));
vi.mock("echarts/core", () => ({ use() {}, init: mock.init }));
vi.mock("echarts/charts", () => ({
  BarChart: {},
  LineChart: {},
  PieChart: {},
}));
vi.mock("echarts/components", () => ({
  TitleComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  GridComponent: {},
}));
vi.mock("echarts/renderers", () => ({ SVGRenderer: {} }));
test("sandbox verifies parent, data and revision before drawing or exporting", async () => {
  document.body.innerHTML = '<div id="graph"></div>';
  mock.init.mockImplementation(() => {
    const instance = {
      dispose: vi.fn(),
      setOption: vi.fn(),
      resize: vi.fn(),
      renderToSVGString: vi.fn(() => "<svg><text>2</text></svg>"),
    };
    mock.instances.push(instance);
    return instance;
  });
  const posted = vi
    .spyOn(window.parent, "postMessage")
    .mockImplementation(() => {});
  await import("./chart-runtime");
  const send = (data: object, source: Window = window.parent) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source,
        data: { channel: "safe", requestId: "one", revision: 1, ...data },
      }),
    );
  send({ type: "render", kind: "chart", source: chartTemplate }, {} as Window);
  expect(mock.init).not.toHaveBeenCalled();
  send({ type: "render", kind: "chart", source: chartTemplate });
  expect(mock.init).toHaveBeenCalledTimes(1);
  expect(mock.instances[0].setOption.mock.calls[0][0].series[0].data).toEqual([
    120, 150, 138, 180,
  ]);
  send({
    type: "command",
    action: "export",
    requestId: "stale",
    format: "png",
  });
  expect(mock.instances[0].renderToSVGString).not.toHaveBeenCalled();
  send({ type: "command", action: "export", format: "png" });
  expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({
    type: "export",
    format: "png",
    requestId: "one",
    revision: 1,
  });
  send({
    type: "render",
    kind: "chart",
    source: chartTemplate,
    requestId: "two",
    revision: 2,
  });
  expect(mock.instances[0].dispose).toHaveBeenCalledOnce();
  send({
    type: "render",
    kind: "chart",
    source: chartTemplate.replace('"type": "bar"', '"type": "custom"'),
    requestId: "bad",
    revision: 3,
  });
  expect(mock.init).toHaveBeenCalledTimes(2);
  expect(mock.instances[1].dispose).toHaveBeenCalledOnce();
  expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({
    type: "error",
    requestId: "bad",
    revision: 3,
  });
  send({ type: "command", action: "export", requestId: "bad", revision: 3 });
  expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({ type: "error" });
});
