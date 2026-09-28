"""
Pydantic models. The device-facing models (PlaylistResponse, RegisterRequest,
HeartbeatRequest) mirror the exact JSON contract already consumed by the
Android TV app -- field names and shapes must NOT change.
"""
from __future__ import annotations

from enum import Enum
from typing import Literal, List, Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------
# Enums
# --------------------------------------------------------------------------
class DeviceCommand(str, Enum):
    none = "none"
    reload = "reload"
    restart = "restart"
    clearWebCache = "clearWebCache"
    blackout = "blackout"


class ItemType(str, Enum):
    video = "video"
    imagen = "imagen"
    link = "link"


class DeviceEstado(str, Enum):
    pendiente = "pendiente"
    activo = "activo"
    deshabilitado = "deshabilitado"


class ItemScale(str, Enum):
    fill = "fill"
    fit = "fit"
    cover = "cover"


# --------------------------------------------------------------------------
# Device-facing: /register
# --------------------------------------------------------------------------
class RegisterRequest(BaseModel):
    deviceId: str
    screenWidth: Optional[int] = None
    screenHeight: Optional[int] = None


class RegisterResponse(BaseModel):
    deviceId: str
    estado: DeviceEstado
    pairingCode: Optional[str] = None
    created: bool
    # Solo se llena una vez que el admin vincula el pairingCode en el panel
    # (estado == "activo"). Permite que la app auto-adopte su X-Device-Key
    # sin que un humano tenga que copiarla del panel a la pantalla de Setup.
    deviceKey: Optional[str] = None


# --------------------------------------------------------------------------
# Device-facing: /heartbeat
# --------------------------------------------------------------------------
class HeartbeatRequest(BaseModel):
    deviceId: str
    appVersion: Optional[str] = None
    itemActual: Optional[str] = None
    uptime: Optional[float] = None
    ultimoError: Optional[str] = None
    screenWidth: Optional[int] = None
    screenHeight: Optional[int] = None


# --------------------------------------------------------------------------
# Device-facing: /playlist
# --------------------------------------------------------------------------
class OverlayModel(BaseModel):
    text: str = ""
    enabled: bool = False


class SettingsModel(BaseModel):
    pollMinutes: int = 5
    muteVideo: bool = True
    transitionMs: int = 500


class PlaylistItemModel(BaseModel):
    id: str
    type: ItemType
    url: str
    durationSec: Optional[int] = None
    scale: Optional[ItemScale] = None
    orden: int
    activo: bool = True


class PlaylistResponse(BaseModel):
    version: int
    updatedAt: str
    deviceName: str
    groupId: Optional[str] = None
    commandId: Optional[str] = None
    command: DeviceCommand = DeviceCommand.none
    overlay: OverlayModel = Field(default_factory=OverlayModel)
    settings: SettingsModel = Field(default_factory=SettingsModel)
    items: List[PlaylistItemModel] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Admin: devices
# --------------------------------------------------------------------------
class DeviceAdminView(BaseModel):
    deviceId: str
    nombre: Optional[str] = None
    groupId: Optional[str] = None
    estado: DeviceEstado
    itemActual: Optional[str] = None
    lastSeen: Optional[str] = None
    appVersion: Optional[str] = None
    resolucion: Optional[str] = None
    ubicacion: Optional[str] = None
    pairingCode: Optional[str] = None
    commandId: Optional[str] = None
    command: Optional[DeviceCommand] = None
    overlay: Optional[OverlayModel] = None
    pollMinutes: Optional[int] = None
    muteVideo: Optional[bool] = None
    ultimoError: Optional[str] = None
    playlistOverrideId: Optional[str] = None
    online: Optional[bool] = None


class PairDeviceRequest(BaseModel):
    pairingCode: str
    nombre: str
    groupId: str


class PairDeviceResponse(BaseModel):
    deviceId: str
    deviceKey: str
    nombre: str
    groupId: str


class CommandRequest(BaseModel):
    command: DeviceCommand


class BulkCommandRequest(BaseModel):
    command: DeviceCommand
    deviceIds: Optional[List[str]] = None
    groupId: Optional[str] = None


class OverlayRequest(BaseModel):
    text: str
    enabled: bool


class ReassignGroupRequest(BaseModel):
    groupId: str


class SetDisabledRequest(BaseModel):
    disabled: bool


class SetPlaylistOverrideRequest(BaseModel):
    playlistId: Optional[str] = None  # null clears the per-device override


# --------------------------------------------------------------------------
# Admin: groups
# --------------------------------------------------------------------------
class GroupSettingsModel(BaseModel):
    pollMinutes: int = 5
    muteVideo: bool = True
    transitionMs: int = 500


class GroupCreateRequest(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    settings: GroupSettingsModel = Field(default_factory=GroupSettingsModel)
    playlistId: Optional[str] = None


class GroupUpdateRequest(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    settings: Optional[GroupSettingsModel] = None
    playlistId: Optional[str] = None


class GroupModel(BaseModel):
    groupId: str
    nombre: str
    descripcion: Optional[str] = None
    settings: GroupSettingsModel
    playlistId: Optional[str] = None
    timezone: Optional[str] = None  # IANA; default America/Mazatlan


# --------------------------------------------------------------------------
# Admin: playlists
# --------------------------------------------------------------------------
class PlaylistItemAdmin(BaseModel):
    id: str
    type: ItemType
    url: str
    durationSec: Optional[int] = None
    scale: Optional[ItemScale] = ItemScale.fill
    orden: int
    activo: bool = True
    vigenciaDesde: Optional[str] = None  # ISO date/datetime, evaluated in America/Mazatlan
    vigenciaHasta: Optional[str] = None
    # Optional weekly/daily window, evaluated in the group's timezone:
    # dias = "Todos" | "Lunes a viernes" | "Fines de semana"; horas "HH:MM".
    dias: Optional[str] = None
    horaInicio: Optional[str] = None
    horaFin: Optional[str] = None
    titulo: Optional[str] = None


class PlaylistCreateRequest(BaseModel):
    nombre: str
    items: List[PlaylistItemAdmin] = Field(default_factory=list)


class PlaylistUpdateRequest(BaseModel):
    nombre: Optional[str] = None
    items: Optional[List[PlaylistItemAdmin]] = None


class PlaylistModel(BaseModel):
    playlistId: str
    nombre: str
    updatedAt: str
    items: List[PlaylistItemAdmin]


# --------------------------------------------------------------------------
# Admin: assets
# --------------------------------------------------------------------------
class SignedUploadRequest(BaseModel):
    filename: str
    contentType: str


class SignedUploadResponse(BaseModel):
    uploadUrl: str
    gcsPath: str
    cdnUrl: str
    method: str = "PUT"
    headers: dict


class AssetCreateRequest(BaseModel):
    nombre: str
    tipo: ItemType
    gcsPath: str
    cdnUrl: str
    bytes: Optional[int] = None
    duracionSec: Optional[int] = None
    thumbnailUrl: Optional[str] = None


class AssetModel(BaseModel):
    assetId: str
    nombre: str
    tipo: ItemType
    gcsPath: str
    cdnUrl: str
    bytes: Optional[int] = None
    duracionSec: Optional[int] = None
    thumbnailUrl: Optional[str] = None
    createdAt: str


# --------------------------------------------------------------------------
# Admin: RH announcement (Content Studio "Convivencia / Anuncio RH" mode) --
# one current announcement per group, read live by the tablero's RH screen
# instead of RH designing a static slide by hand.
# --------------------------------------------------------------------------
class RHAnnouncementUpsertRequest(BaseModel):
    titulo: str
    fecha: str
    lugar: str
    fotoUrl: Optional[str] = None
    ctaTexto: str = "¡LOS ESPERAMOS!"
    activo: bool = True


class RHAnnouncementModel(BaseModel):
    groupId: str
    titulo: str
    fecha: str
    lugar: str
    fotoUrl: Optional[str] = None
    ctaTexto: str = "¡LOS ESPERAMOS!"
    activo: bool = True
    updatedAt: str


# --------------------------------------------------------------------------
# Admin: reports
# --------------------------------------------------------------------------
class UptimeReportRow(BaseModel):
    fecha: str
    deviceId: str
    nombre: Optional[str] = None
    groupId: Optional[str] = None
    uptimePct: float


class AvailabilityByGroupRow(BaseModel):
    groupId: str
    fecha: str
    dispositivosTotal: int
    dispositivosOnline: int
    disponibilidadPct: float


class ErrorRow(BaseModel):
    itemId: str
    url: Optional[str] = None
    tipo: Optional[str] = None
    errores: int


class ProofOfPlayRow(BaseModel):
    ts: str
    deviceId: str
    itemId: str
    tipo: str
    url: str
    durationSec: Optional[int] = None
    resultado: str


# --------------------------------------------------------------------------
# Sync (Sheet "CaptaVision · Contenido de Pantallas" -> playlists), called by
# the automation with X-Sync-Key, not by the admin panel.
# --------------------------------------------------------------------------
class SyncGroup(BaseModel):
    groupId: str
    nombre: str
    descripcion: Optional[str] = None
    timezone: Optional[str] = None


class SyncItem(BaseModel):
    id: str  # Sheet row ID (e.g. "C-0005"); stored as "sheet-<id>"
    # "comunicado" = text-only slide: the backend builds a `link` item to
    # /public/comunicado from titulo + texto, so `url` may be empty.
    type: Literal["imagen", "video", "link", "comunicado"]
    url: str = ""
    titulo: Optional[str] = None
    texto: Optional[str] = None
    grupos: List[str]  # groupIds, or ["*"] for every group
    durationSec: Optional[int] = None
    orden: int = 0
    vigenciaDesde: Optional[str] = None
    vigenciaHasta: Optional[str] = None
    dias: Optional[str] = None
    horaInicio: Optional[str] = None
    horaFin: Optional[str] = None


class SyncRequest(BaseModel):
    grupos: List[SyncGroup] = Field(default_factory=list)
    items: List[SyncItem] = Field(default_factory=list)


class SyncResponse(BaseModel):
    gruposCreados: List[str]
    gruposActualizados: List[str]
    playlistsActualizadas: List[str]
    gruposDesconocidos: List[str]
