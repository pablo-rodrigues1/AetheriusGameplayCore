#include "DevAttributes.h"
#include "MpActor.h"
#include "SpSnippet.h"
#include "WorldState.h"

bool MpActor::HasDevAttributes() const
{
  return aetheriusDevAttributes.has_value() && IsCreatedAsPlayer()
    && GetUserId() != Networking::InvalidUserId
    && GetUserId() == aetheriusDevAttributesUser;
}

void MpActor::ApplyDevAttributes(BaseActorValues& values) const
{
  if (HasDevAttributes()) aetheriusDevAttributes->Apply(values);
}

void MpActor::SetDevAttributes(
  const std::optional<aetherius::development::Attributes>& attributes)
{
  if (attributes) {
    attributes->Validate();
    if (!IsCreatedAsPlayer() || GetUserId() == Networking::InvalidUserId
        || GetProfileId() < 1)
      throw std::invalid_argument("DEV attributes require an online player profile");
  }
  const bool hadValue = aetheriusDevAttributes.has_value();
  aetheriusDevAttributes = attributes;
  aetheriusDevAttributesUser = GetUserId();
  ++aetheriusDevAttributesRevision;
  if (!attributes && !hadValue) return;
  if (!IsCreatedAsPlayer() || GetUserId() == Networking::InvalidUserId) return;

  SendAttributeMaximumValues();
}

// AETHERIUS C3d: same delivery and ACK guards for the single effective maximum.
void MpActor::SendAttributeMaximumValues()
{
  // Reuse the existing client Actor.SetActorValue bridge. Its ACK certifies
  // completion of the calls only. Send percentages after all three ACKs so an
  // old maximum cannot be used by the client's ChangeValues handler.
  const auto values = GetMaximumValues();
  const auto revision = aetheriusDevAttributesRevision;
  const auto user = GetUserId();
  const std::weak_ptr<MpForm> weak = GetParent()->LookupFormById(GetFormId());
  const auto remaining = std::make_shared<int>(3);
  const std::pair<const char*, float> resources[] = {
    { "Health", values.health }, { "Magicka", values.magicka },
    { "Stamina", values.stamina }
  };
  for (const auto& [name, value] : resources) {
    const std::vector<std::optional<std::variant<bool, double, std::string,
      SpSnippetObjectArgument>>> args = { std::string(name), double(value) };
    SpSnippet("Actor", "SetActorValue", args, GetFormId())
      .Execute(this, SpSnippetMode::kReturnResult)
      .Then([weak, revision, user, remaining](VarValue) {
        auto form = weak.lock();
        auto actor = form ? form->AsActor() : nullptr;
        if (!actor || actor->aetheriusDevAttributesRevision != revision
            || actor->GetUserId() != user || actor->IsDisabled()) return;
        if (--*remaining == 0)
          actor->NetSendChangeValues(actor->GetActorValues(), std::nullopt);
      });
  }
}

bool MpActor::HasAttributeBonuses() const
{
  return aetheriusAttributeBonuses.has_value() && IsCreatedAsPlayer()
    && GetUserId() != Networking::InvalidUserId
    && GetUserId() == aetheriusAttributeBonusesUser
    && GetProfileId() == aetheriusAttributeBonusesProfile;
}

void MpActor::SetAttributeBonuses(
  const std::optional<aetherius::attributes::Bonuses>& bonuses)
{
  if (bonuses) {
    bonuses->Validate();
    if (!IsCreatedAsPlayer() || GetUserId() == Networking::InvalidUserId
        || GetProfileId() < 1)
      throw std::invalid_argument("ATTRIBUTE_OFFICIAL_PLAYER_REQUIRED");
    if (HasDevAttributes())
      throw std::invalid_argument("ATTRIBUTE_DEV_WRITER_ACTIVE");
  }
  const bool hadValue = aetheriusAttributeBonuses.has_value();
  aetheriusAttributeBonuses = bonuses;
  aetheriusAttributeBonusesUser = GetUserId();
  aetheriusAttributeBonusesProfile = GetProfileId();
  ++aetheriusDevAttributesRevision; // Shared maximum delivery invalidates old ACKs.
  if (!bonuses && !hadValue) return;
  if (!IsCreatedAsPlayer() || GetUserId() == Networking::InvalidUserId) return;
  SendAttributeMaximumValues();
}
