import * as d3Scale from "d3-scale-chromatic";
import { computed } from "mobx";
import Color from "terriajs-cesium/Source/Core/Color";
import createColorForIdTransformer from "../Core/createColorForIdTransformer";
import filterOutUndefined from "../Core/filterOutUndefined";
import isDefined from "../Core/isDefined";
import StandardCssColors from "../Core/StandardCssColors";
import ColorMap from "../Map/ColorMap";
import ConstantColorMap from "../Map/ConstantColorMap";
import ContinuousColorMap from "../Map/ContinuousColorMap";
import DiscreteColorMap from "../Map/DiscreteColorMap";
import EnumColorMap from "../Map/EnumColorMap";
import Model from "../Models/Definition/Model";
import ModelPropertiesFromTraits from "../Models/Definition/ModelPropertiesFromTraits";
import TableColorStyleTraits, {
  EnumColorTraits
} from "../Traits/TraitsClasses/TableColorStyleTraits";
import TableColumn from "./TableColumn";
import TableColumnType from "./TableColumnType";
import TerriaError from "../Core/TerriaError";
import runLater from "../Core/runLater";

const getColorForId = createColorForIdTransformer();
const defaultColor = "yellow";

export default class TableColorMap {
  constructor(
    /** Title used for ConstantColorMaps - and to create a unique color for a particular Table-based CatalogItem */
    readonly title: string | undefined,
    readonly colorColumn: TableColumn | undefined,
    readonly colorTraits: Model<TableColorStyleTraits>
  ) {}

  /**
   * Gets an object used to map values in {@link #colorColumn} to colors
   * for this style.
   * Will try to create most appropriate colorMap given colorColumn:
   * - If column type is `scalar` and we have binMaximums - use DiscreteColorMap
   * - If column type is `scalar` and we have a valid minValue and maxValue - use ContinuousColorMap
   * - If column type is enum or region - and we have enough binColors to represent uniqueValues - use EnumColorMap
   * - Otherwise, use ConstantColorMap
   */
  @computed
  get colorMap(): ColorMap {
    const colorColumn = this.colorColumn;
    const colorTraits = this.colorTraits;

    const nullColor = colorTraits.nullColor
      ? Color.fromCssColorString(colorTraits.nullColor) ?? Color.TRANSPARENT
      : Color.TRANSPARENT;

    // If column type is `scalar` - use DiscreteColorMap or ContinuousColorMap
    if (colorColumn && colorColumn.type === TableColumnType.scalar) {
      // If column type is `scalar` and we have binMaximums - use DiscreteColorMap
      if (this.binMaximums.length > 0) {
        return new DiscreteColorMap({
          bins: this.binColors.map((color, i) => {
            return {
              color: color,
              maximum: this.binMaximums[i],
              includeMinimumInThisBin: false
            };
          }),
          nullColor
        });
      }

      // If column type is `scalar` and we have a valid minValue and maxValue - use ContinuousColorMap
      const minValue =
        colorTraits.minimumValue ?? colorColumn?.valuesAsNumbers.minimum;
      const maxValue =
        colorTraits.maximumValue ?? colorColumn?.valuesAsNumbers.maximum;

      if (isDefined(minValue) && isDefined(maxValue) && minValue !== maxValue) {
        // Get colorScale from `d3-scale-chromatic` library - all continuous color schemes start with "interpolate"
        // See https://github.com/d3/d3-scale-chromatic#diverging
        // d3 continuous color schemes are represented as a function which map a value [0,1] to a color]
        let colorScale = this.colorScaleContinuous();

        return new ContinuousColorMap({
          colorScale,
          minValue,
          maxValue,
          nullColor
        });
      }
    }

    // If column type is enum or region - and we have enough binColors to represent uniqueValues - use EnumColorMap
    if (
      colorColumn &&
      (colorColumn.type === TableColumnType.enum ||
        colorColumn.type === TableColumnType.region) &&
      colorColumn.uniqueValues.values.length <= this.enumColors.length
    ) {
      return new EnumColorMap({
        enumColors: filterOutUndefined(
          this.enumColors.map(e => {
            if (e.value === undefined || e.color === undefined) {
              return undefined;
            }
            return {
              value: e.value,
              color:
                colorColumn.type !== TableColumnType.region
                  ? Color.fromCssColorString(e.color) ?? Color.TRANSPARENT
                  : this.regionColor
            };
          })
        ),
        nullColor: this.nullColor
      });
    }

    // No useful colorMap can be generated - so use the same color for everything.

    // Try to find a useful color to use
    let color: Color | undefined;

    // If colorColumn is of type region - use regionColor
    if (colorColumn?.type === TableColumnType.region && this.regionColor) {
      color = this.regionColor;
    } else if (colorTraits.nullColor) {
      color = Color.fromCssColorString(colorTraits.nullColor);
    } else if (colorTraits.binColors && colorTraits.binColors.length > 0) {
      color = Color.fromCssColorString(colorTraits.binColors[0]);
    } else if (this.title) {
      color = Color.fromCssColorString(getColorForId(this.title));
    }

    if (!color) {
      color = Color.fromCssColorString(defaultColor);
    }

    return new ConstantColorMap({
      color,
      title: this.title,

      // Use nullColor if colorColumn is of type `region`
      // This is so we only see regions which rows exist for (everything else will use nullColor)
      nullColor:
        colorColumn?.type === TableColumnType.region
          ? this.nullColor
          : undefined
    });
  }

  /**
   * Bin colors used to represent `scalar` TableColumns in a DiscreteColorMap
   */
  @computed
  get binColors(): readonly Readonly<Color>[] {
    const numberOfBins = this.binMaximums.length;

    // Pick a color for every bin.
    const binColors = this.colorTraits.binColors || [];

    let colorScale = this.colorScaleCategorical(this.binMaximums.length);

    const result: Color[] = [];
    for (let i = 0; i < numberOfBins; ++i) {
      if (i < binColors.length) {
        result.push(
          Color.fromCssColorString(binColors[i]) ?? Color.TRANSPARENT
        );
      } else {
        result.push(
          Color.fromCssColorString(colorScale[i % colorScale.length])
        );
      }
    }
    return result;
  }

  /**
   * Bin maximums used to represent `scalar` TableColumns in a DiscreteColorMap
   * These map directly to `this.binColors`
   */
  @computed
  get binMaximums(): readonly number[] {
    const colorColumn = this.colorColumn;
    if (colorColumn === undefined) {
      return this.colorTraits.binMaximums || [];
    }

    const binMaximums = this.colorTraits.binMaximums;
    if (binMaximums !== undefined) {
      if (
        colorColumn.type === TableColumnType.scalar &&
        colorColumn.valuesAsNumbers.maximum !== undefined &&
        (binMaximums.length === 0 ||
          colorColumn.valuesAsNumbers.maximum >
            binMaximums[binMaximums.length - 1])
      ) {
        // Add an extra bin to accomodate the maximum value of the dataset.
        return binMaximums.concat([colorColumn.valuesAsNumbers.maximum]);
      }
      return binMaximums;
    } else if (this.colorTraits.numberOfBins === 0) {
      return [];
    } else {
      // TODO: compute maximums according to ckmeans, quantile, etc.
      const asNumbers = colorColumn.valuesAsNumbers;
      const min = asNumbers.minimum;
      const max = asNumbers.maximum;
      if (min === undefined || max === undefined) {
        return [];
      }
      const numberOfBins =
        colorColumn.uniqueValues.values.length < this.colorTraits.numberOfBins
          ? colorColumn.uniqueValues.values.length
          : this.colorTraits.numberOfBins;
      let next = min;
      const step = (max - min) / numberOfBins;

      const result: number[] = [];
      for (let i = 0; i < numberOfBins - 1; ++i) {
        next += step;
        result.push(next);
      }

      result.push(max);

      return result;
    }
  }

  /**
   * Enum bin colors used to represent `enum` or `region` TableColumns in a EnumColorMap
   */
  @computed
  get enumColors(): readonly ModelPropertiesFromTraits<EnumColorTraits>[] {
    if (this.colorTraits.enumColors?.length ?? 0 > 0) {
      return this.colorTraits.enumColors!;
    }

    const colorColumn = this.colorColumn;
    if (colorColumn === undefined) {
      return [];
    }

    // Create a color for each unique value
    const uniqueValues = colorColumn.uniqueValues.values;

    let colorScale = this.colorScaleCategorical(uniqueValues.length);

    return colorScale.map((color, i) => {
      return {
        value: uniqueValues[i],
        color
      };
    });
  }

  @computed get nullColor() {
    return this.colorTraits.nullColor
      ? Color.fromCssColorString(this.colorTraits.nullColor) ??
          Color.TRANSPARENT
      : Color.TRANSPARENT;
  }

  @computed get regionColor() {
    return Color.fromCssColorString(this.colorTraits.regionColor);
  }

  /** Get default colorPalete name.
   * Follows https://github.com/d3/d3-scale-chromatic#api-reference
   * If Enum or Region - use custom HighContrast (See StandardCssColors.highContrast)
   * If scalar and not diverging - use Reds palette
   * If scalar and diverging - use Purple to Orange palette
   *
   * NOTE: it is **very** important that these values are valid color palettes.
   * If they are not, Terria will crash
   */
  @computed
  get defaultColorPaletteName(): "Turbo" | "HighContrast" | "PuOr" | "Reds" {
    const colorColumn = this.colorColumn;

    if (colorColumn === undefined) {
      // This shouldn't get used - as if there is no colorColumn - there is nothing to visualise!
      return "Turbo";
    }

    if (
      colorColumn.type === TableColumnType.enum ||
      colorColumn.type === TableColumnType.region
    ) {
      // Enumerated values, so use a large, high contrast palette.
      return "HighContrast";
    } else if (colorColumn.type === TableColumnType.scalar) {
      const valuesAsNumbers = colorColumn.valuesAsNumbers;
      if (
        valuesAsNumbers !== undefined &&
        (valuesAsNumbers.minimum || 0.0) < 0.0 &&
        (valuesAsNumbers.maximum || 0.0) > 0.0
      ) {
        // Values cross zero, so use a diverging palette
        return "PuOr";
      } else {
        // Values do not cross zero so use a sequential palette.
        return "Reds";
      }
    }

    return "Reds";
  }

  /**
   * Get colorScale from `d3-scale-chromatic` library - all continuous color schemes start with "interpolate"
   * See https://github.com/d3/d3-scale-chromatic#diverging
   */
  colorScaleContinuous(): (value: number) => string {
    // d3 continuous color schemes are represented as a function which map a value [0,1] to a color]
    let colorScale: ((value: number) => string) | undefined;

    // If colorPalete trait is defined - try to resolve it
    if (isDefined(this.colorTraits.colorPalette)) {
      colorScale = (d3Scale as any)[
        `interpolate${this.colorTraits.colorPalette}`
      ];
    }

    // If no colorScaleScheme found - use `defaultColorPaletteName` to find one
    if (!isDefined(colorScale)) {
      if (isDefined(this.colorTraits.colorPalette)) {
        this.invalidColorPaletteWarning();
      }
      colorScale = (d3Scale as any)[
        `interpolate${this.defaultColorPaletteName}`
      ] as (value: number) => string;
    }

    return colorScale;
  }

  /**
   * Get categorical colorScale from `d3-scale-chromatic` library - all categorical color schemes start with "scheme"
   * See https://github.com/d3/d3-scale-chromatic#categorical
   * @param numberOfBins
   */
  colorScaleCategorical(numberOfBins: number): string[] {
    // d3 categorical color schemes are represented as either:
    // Two dimensional arrays
    //   - First array represents number of bins in the given color scale (eg 3 = [#ff0000, #ffaa00, #ffff00])
    //   - Second aray contains color values
    // One dimensional array
    //   - Just an array of color values
    //   - For example schemeCategory10 (https://github.com/d3/d3-scale-chromatic#schemeCategory10) is a fixed color scheme with 10 values

    let colorScaleScheme: any;

    // If colorPalete trait is defined - try to resolve it
    if (isDefined(this.colorTraits.colorPalette)) {
      // "HighContrast" is a custom additonal palette
      if (this.colorTraits.colorPalette === "HighContrast") {
        colorScaleScheme = StandardCssColors.highContrast;
      } else {
        colorScaleScheme = (d3Scale as any)[
          `scheme${this.colorTraits.colorPalette}`
        ];
      }
    }

    // If no colorScaleScheme found - use `defaultColorPaletteName` to find one
    if (!colorScaleScheme) {
      if (isDefined(this.colorTraits.colorPalette)) {
        this.invalidColorPaletteWarning();
      }

      if (this.defaultColorPaletteName === "HighContrast") {
        colorScaleScheme = StandardCssColors.highContrast;
      } else {
        colorScaleScheme = (d3Scale as any)[
          `scheme${this.defaultColorPaletteName}`
        ];
      }
    }

    let colorScale: string[];

    // If color scheme is one dimensional array (eg schemeCategory10 or HighContrast)
    if (typeof colorScaleScheme[0] === "string") {
      colorScale = colorScaleScheme;
      // Color scheme is two dimensional - so find appropriate set
    } else {
      colorScale = colorScaleScheme[numberOfBins];
      // If invalid numberOfBins - use largest set provided by d3
      if (!Array.isArray(colorScale)) {
        colorScale = colorScaleScheme[colorScaleScheme.length - 1];
      }
    }

    return colorScale;
  }

  // TODO: Make TableColorMap use Result to pass warnings up model layer
  invalidColorPaletteWarning() {
    if (
      this.colorColumn?.name &&
      this.colorColumn?.tableModel.activeStyle === this.colorColumn?.name
    ) {
      runLater(() =>
        this.colorColumn?.tableModel.terria.raiseErrorToUser(
          new TerriaError({
            title: "Invalid colorPalette",
            message: `Column ${this.colorColumn?.name} has an invalid color palette - \`"${this.colorTraits.colorPalette}"\`.
            Will use default color palete \`"${this.defaultColorPaletteName}"\` instead`
          })
        )
      );
    }
  }
}
