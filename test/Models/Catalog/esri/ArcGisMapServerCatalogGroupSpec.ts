import { configure, runInAction } from "mobx";
import _loadWithXhr from "../../../../lib/Core/loadWithXhr";
import Terria from "../../../../lib/Models/Terria";
import ArcGisMapServerCatalogGroup from "../../../../lib/Models/Catalog/Esri/ArcGisMapServerCatalogGroup";
import CommonStrata from "../../../../lib/Models/Definition/CommonStrata";
import i18next from "i18next";
import ArcGisMapServerCatalogItem from "../../../../lib/Models/Catalog/Esri/ArcGisMapServerCatalogItem";

configure({
  enforceActions: "observed",
  computedRequiresReaction: true
});

interface ExtendedLoadWithXhr {
  (): any;
  load: { (...args: any[]): any; calls: any };
}

const loadWithXhr: ExtendedLoadWithXhr = <any>_loadWithXhr;

describe("ArcGisMapServerCatalogGroup", function() {
  const mapServerUrl =
    "http://example.com/arcgis/rest/services/Redlands_Emergency_Vehicles/MapServer";
  const mapServerErrorUrl =
    "http://example.com/arcgis/rest/services/unknown/MapServer";
  let terria: Terria;
  let group: ArcGisMapServerCatalogGroup;

  beforeEach(function() {
    terria = new Terria({
      baseUrl: "./"
    });
    group = new ArcGisMapServerCatalogGroup("test", terria);

    const realLoadWithXhr = loadWithXhr.load;
    // We replace calls to real servers with pre-captured JSON files so our testing is isolated, but reflects real data.
    spyOn(loadWithXhr, "load").and.callFake(function(...args: any[]) {
      let url = args[0];

      if (url.match("Redlands_Emergency_Vehicles/MapServer")) {
        url = url.replace(/^.*\/MapServer/, "MapServer");
        url = url.replace(/MapServer\/?\?f=json$/i, "mapServer.json");
        url = url.replace(/MapServer\/17\/?\?.*/i, "17.json");
        args[0] = "test/ArcGisMapServer/Redlands_Emergency_Vehicles/" + url;
      }

      return realLoadWithXhr(...args);
    });
  });

  it("has a type and typeName", function() {
    expect(group.type).toBe("esri-mapServer-group");
    expect(group.typeName).toBe(
      i18next.t("models.arcGisMapServerCatalogGroup.name")
    );
  });

  describe("after loading metadata", function() {
    beforeEach(async function() {
      runInAction(() => {
        group.setTrait("definition", "url", mapServerUrl);
      });
      await group.loadMetadata();
    });

    it("defines info", function() {
      const serviceDescription = i18next.t(
        "models.arcGisMapServerCatalogGroup.serviceDescription"
      );
      const dataDescription = i18next.t(
        "models.arcGisMapServerCatalogGroup.dataDescription"
      );
      const copyrightText = i18next.t(
        "models.arcGisMapServerCatalogGroup.copyrightText"
      );

      expect(group.info.map(({ name }) => name)).toEqual([
        serviceDescription,
        dataDescription,
        copyrightText
      ]);
      expect(group.info.map(({ content }) => content)).toEqual([
        "Vehicle Service Description",
        "Vehicle Description",
        "Vehicle Copyright"
      ]);
    });
  });

  describe("loadMembers", function() {
    it("properly creates members", async function() {
      runInAction(() => {
        group.setTrait(CommonStrata.definition, "url", mapServerUrl);
      });

      await group.loadMembers();

      expect(group.members).toBeDefined();
      expect(group.members.length).toBe(4);
      expect(group.memberModels).toBeDefined();
      expect(group.memberModels.length).toBe(4);

      let member0 = <ArcGisMapServerCatalogItem>group.memberModels[0];
      let member1 = <ArcGisMapServerCatalogItem>group.memberModels[1];
      let member2 = <ArcGisMapServerCatalogItem>group.memberModels[2];
      let member3 = <ArcGisMapServerCatalogGroup>group.memberModels[3];

      expect(member0.name).toBe("Ambulances");
      expect(member0.url).toBe(mapServerUrl + "/0");

      expect(member1.name).toBe("Police");
      expect(member1.url).toBe(mapServerUrl + "/1");

      expect(member2.name).toBe("Fire");
      expect(member2.url).toBe(mapServerUrl + "/25");

      expect(member3.name).toBe("911 Calls Hotspot");
      expect(member3.url).toBe(mapServerUrl + "/17");

      expect(member3.members.length).toBe(0);
      expect(member3.memberModels.length).toBe(0);

      await member3.loadMembers();

      expect(member3.members.length).toBe(2);
      expect(member3.memberModels.length).toBe(2);

      let member4 = <ArcGisMapServerCatalogGroup>member3.memberModels[0];
      let member5 = <ArcGisMapServerCatalogGroup>member3.memberModels[1];
      expect(member4.name).toBe("Output Features");
      expect(member4.url).toBe(mapServerUrl + "/23");

      expect(member5.name).toBe("Hotspot Raster");
      expect(member5.url).toBe(mapServerUrl + "/27");
    });

    it("throws error on unavailable url", async function() {
      runInAction(() => {
        group.setTrait(CommonStrata.definition, "url", mapServerErrorUrl);
      });

      const error = (await group.loadMembers()).error;

      expect(error).toBeDefined("Load member should error");
    });

    it("throws error if it's not mapserver ", async function() {
      runInAction(() => {
        group.setTrait(CommonStrata.definition, "url", mapServerErrorUrl);
      });

      const error = (await group.loadMembers()).error;

      expect(error).toBeDefined("Load member should error");
    });
  });
});
