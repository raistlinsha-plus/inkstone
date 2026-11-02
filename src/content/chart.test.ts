import { describe, expect, test } from "vitest";
import { chartOption, chartTemplate, chartText, parseChart } from "./chart";
const fixture = () => JSON.parse(chartTemplate);
describe("chart v1 data contract", () => {
  test("bar, line and pie preserve values, missing points and units", () => {
    for (const type of ["bar", "line", "pie"]) {
      const data = fixture();
      data.type = type;
      data.series[0].values[1] = null;
      const valid = parseChart(JSON.stringify(data));
      expect(valid.series[0].values).toEqual([120, null, 138, 180]);
      expect(chartText(valid)).toContain("Q2：收入 缺失");
      expect(chartText(valid)).toContain("Q1：收入 120万元");
      const compiled = chartOption(valid);
      expect(compiled.animation).toBe(false);
      expect(compiled.tooltip.renderMode).toBe("richText");
      expect(compiled.series[0].type).toBe(type);
    }
  });
  test.each([
    [
      "option root",
      (d: any) => {
        d.tooltip = { formatter: "evil" };
      },
    ],
    [
      "nested custom data",
      (d: any) => {
        d.series[0].itemStyle = { image: "https://example.invalid" };
      },
    ],
    [
      "unsupported chart",
      (d: any) => {
        d.type = "custom";
      },
    ],
    [
      "unknown version",
      (d: any) => {
        d.schemaVersion = 2;
      },
    ],
    [
      "length mismatch",
      (d: any) => {
        d.series[0].values.pop();
      },
    ],
    [
      "all missing",
      (d: any) => {
        d.series[0].values = [null, null, null, null];
      },
    ],
    [
      "duplicate category",
      (d: any) => {
        d.x.values[1] = d.x.values[0];
      },
    ],
    [
      "negative pie",
      (d: any) => {
        d.type = "pie";
        d.series[0].values[0] = -1;
      },
    ],
    [
      "zero pie",
      (d: any) => {
        d.type = "pie";
        d.series[0].values = [0, 0, 0, 0];
      },
    ],
    [
      "multi-series pie",
      (d: any) => {
        d.type = "pie";
        d.series.push({ name: "另一组", values: [1, 2, 3, 4] });
      },
    ],
    [
      "external source",
      (d: any) => {
        d.sourceRefs = ["https://example.invalid"];
      },
    ],
    [
      "duplicate source",
      (d: any) => {
        d.sourceRefs = ["S1", "S1"];
      },
    ],
  ])("rejects %s before compiling a renderer option", (_, modify) => {
    const data = fixture();
    modify(data);
    expect(() => parseChart(JSON.stringify(data))).toThrow();
  });
  test("rejects duplicate keys and truncated fences", () => {
    expect(() =>
      parseChart(
        chartTemplate.replace('"type": "bar"', '"type": "line", "type": "bar"'),
      ),
    ).toThrow(/重复键/);
    expect(() => parseChart(chartTemplate.slice(0, -1))).toThrow(/语法/);
  });
  test.each([
    "9007199254740993",
    "0.1000000000000000000001",
    "1e309",
    "1e-999",
    "-9007199254740992",
  ])("does not silently round %s", (raw) => {
    expect(() => parseChart(chartTemplate.replace("120,", raw + ","))).toThrow(
      /精度|范围/,
    );
  });
  test.each(["0.1", "120.00", "1.20e2", "-0.5", "0", "9007199254740991"])(
    "accepts decimal-equivalent numeric text %s",
    (raw) => {
      expect(
        parseChart(chartTemplate.replace("120,", raw + ",")).series[0]
          .values[0],
      ).toBe(Number(raw));
    },
  );
  test("bounds byte size, points and number of series", () => {
    expect(() => parseChart(" ".repeat(50001) + chartTemplate)).toThrow(
      /50 KB/,
    );
    const data = fixture();
    data.x.values = Array.from({ length: 501 }, (_, i) => String(i));
    data.series = [
      { name: "A", values: data.x.values.map(() => 1) },
      { name: "B", values: data.x.values.map(() => 2) },
    ];
    expect(() => parseChart(JSON.stringify(data))).toThrow(/1000/);
  });
  test("compiles horizontal and donut styles without forwarding input keys", () => {
    const data = fixture();
    data.orientation = "horizontal";
    const option = chartOption(parseChart(JSON.stringify(data)));
    expect(option.xAxis?.type).toBe("value");
    expect(option.yAxis?.type).toBe("category");
    data.type = "pie";
    data.donut = true;
    expect(
      chartOption(parseChart(JSON.stringify(data))).series[0],
    ).toMatchObject({ radius: ["38%", "65%"] });
  });
});
