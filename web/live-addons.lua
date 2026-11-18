-- Garry's Web: addons installed while the game runs start working straight away, the way Workshop subscriptions do in
-- Garry's Mod. The page installs the .gma into garrysmod/addons/ and the menu adds its name to data/garrysweb/mount.txt;
-- this file (put in lua/autorun/ by web/storage-worker.js, so it runs on both the server and the client) notices, mounts
-- the addon with game.MountGMA, runs its autorun Lua, registers its weapons, entities and effects, and refreshes the
-- spawn menu. Addons that were already mounted when the map started are left alone.
if GarrysWebLive then return end
GarrysWebLive = { done = {} }
local done = GarrysWebLive.done

local function wanted()
	local out = {}
	for name in (file.Read("garrysweb/mount.txt", "DATA") or ""):gmatch("[^\r\n]+") do out[#out + 1] = name end
	return out
end
-- What the engine mounted itself at start (its file names, without the addons/ folder).
for _, a in ipairs(engine.GetAddons and engine.GetAddons() or {}) do
	if a.mounted and a.file then done[string.GetFileFromFilename(a.file)] = true end
end

local function run(path)
	local ok, err = pcall(include, path)
	if not ok then ErrorNoHalt("[Garry's Web] " .. path .. ": " .. tostring(err) .. "\n") end
end

-- One scripted class (weapon, entity or effect) the way Garry's Mod loads them at start: either folder/class.lua, or
-- folder/class/ with shared.lua plus init.lua (server) and cl_init.lua (client).
local function loadClass(folder, class, single, has, global, register)
	local t = { Folder = folder .. "/" .. class, ClassName = class }
	if global == "SWEP" then t.Primary = {} t.Secondary = {} end
	local old = _G[global]
	_G[global] = t
	if single then run(folder .. "/" .. class .. ".lua")
	elseif SERVER and has.init then run(folder .. "/" .. class .. "/init.lua")
	elseif CLIENT and has.cl_init then run(folder .. "/" .. class .. "/cl_init.lua")
	elseif has.shared then run(folder .. "/" .. class .. "/shared.lua") end
	register(_G[global], class)
	_G[global] = old
end

local function activate(files)
	local classes = { weapons = {}, entities = {}, effects = {} }
	local autorun = {}
	for _, f in ipairs(files) do
		local p = f:match("^lua/(.+%.lua)$")
		if p then
			if p:match("^autorun/[^/]+$") or (SERVER and p:match("^autorun/server/[^/]+$")) or (CLIENT and p:match("^autorun/client/[^/]+$")) then
				autorun[#autorun + 1] = p
			end
			local kind, rest = p:match("^(%a+)/(.+)$")
			if classes[kind] then
				local class = rest:match("^([^/]+)%.lua$")
				if class then classes[kind][class] = { single = true }
				else
					local c, part = rest:match("^([^/]+)/([^/]+)%.lua$")
					if c then classes[kind][c] = classes[kind][c] or {} classes[kind][c][part] = true end
				end
			end
		end
	end
	for _, p in ipairs(autorun) do run(p) end
	for class, has in pairs(classes.weapons) do loadClass("weapons", class, has.single, has, "SWEP", weapons.Register) end
	for class, has in pairs(classes.entities) do loadClass("entities", class, has.single, has, "ENT", scripted_ents.Register) end
	if CLIENT then
		for class, has in pairs(classes.effects) do loadClass("effects", class, has.single, has, "EFFECT", effects.Register) end
	end
end

local function check()
	for _, name in ipairs(wanted()) do
		if not done[name] then
			done[name] = true
			local ok, files = game.MountGMA("addons/" .. name)
			if ok then
				activate(files or {})
				if CLIENT then timer.Simple(0.2, function() RunConsoleCommand("spawnmenu_reload") end) end
				-- the last addon each side mounted, for the page and for tests
				file.Write("garrysweb/live_" .. (SERVER and "server" or "client") .. ".txt", name .. " " .. #(files or {}) .. " " .. os.time())
			else
				ErrorNoHalt("[Garry's Web] could not mount " .. name .. "\n")
			end
		end
	end
end
timer.Create("GarrysWebLiveAddons", 1, 0, check)
check()
