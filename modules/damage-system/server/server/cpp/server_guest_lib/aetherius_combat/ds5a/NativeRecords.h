#pragma once
#include "Bridge.h"
#include "libespm/espm.h"
#include "libespm/IterateFields.h"
#include <cstring>
namespace aetherius::combat::ds5a {
// Called once by SetCatalog, never by Evaluate. Winners use source-aware links.
inline void HydrateNative(Catalog& catalog,const espm::CombineBrowser& browser) {
  auto& cache=browser.GetCache();
  const auto source=browser.FindSourceByFilename("Skyrim.esm");
  if(source) {
    const auto record=browser.LookupById(browser.ToRuntimeFormId(*source,0x031899));
    if(const auto gmst=espm::Convert<espm::GMST>(record.rec)) {
      const double value=gmst->GetData(cache).value;
      if(InRange(value,100))catalog.powerBonus={true,value};
    }
  }
  for(auto& row:catalog.records) {
    auto& record=row.second;if(!record.supported)continue;
    if(record.kind==Record::Kind::Armor) {
      const auto armo=espm::Convert<espm::ARMO>(browser.LookupById(row.first).rec);
      if(armo) {const auto data=armo->GetData(cache);if(data.equipSlotId)record.itemType={true,10};}
      continue;
    }
    if(record.kind!=Record::Kind::Weapon)continue;
    uint32_t id=row.first;std::array<uint32_t,32> visited{};size_t count=0;
    for(;;) {
      if(count==visited.size()||std::find(visited.begin(),visited.begin()+count,id)!=visited.begin()+count)break;
      visited[count++]=id;
      const auto lookup=browser.LookupById(id);const auto weapon=espm::Convert<espm::WEAP>(lookup.rec);
      if(!weapon)break;
      uint32_t parent=0;Value critical;
      espm::IterateFields_(weapon,[&](const char* type,uint32_t size,const char* data) {
        if(!std::memcmp(type,"CNAM",4)&&size==4)std::memcpy(&parent,data,4);
        // CRDT starts with the ushort Critical.Damage; verified against exported winners.
        if(!std::memcmp(type,"CRDT",4)&&size>=2) {uint16_t damage=0;std::memcpy(&damage,data,2);critical={true,double(damage)};}
      },cache);
      if(parent){id=lookup.ToGlobalId(parent);continue;} // Q15a: template base, no enchantment magnitude.
      record.criticalBase=critical;
      const auto data=weapon->GetData(cache);
      if(data.weapDNAM) {
        const auto type=static_cast<unsigned>(data.weapDNAM->animType);
        // WEAP anim enum 8=staff,9=crossbow; GetEquippedItemType uses 8=staff,12=crossbow.
        record.itemType={true,double(type==9?12:type)};
      }
      break;
    }
  }
}
}
