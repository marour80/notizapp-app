#!/usr/bin/env ruby
# Bindet ios/App/App/GoogleService-Info.plist ins App-Target ein (Resources-Phase).
# Nutzung:  ruby ios/add-googleservice.rb
require 'xcodeproj'

proj_path = File.expand_path(File.join(__dir__, 'App', 'App.xcodeproj'))
plist_rel = 'App/GoogleService-Info.plist'
plist_abs = File.expand_path(File.join(__dir__, 'App', 'App', 'GoogleService-Info.plist'))

abort("FEHLER: #{plist_abs} nicht gefunden – bitte GoogleService-Info.plist dorthin legen.") unless File.exist?(plist_abs)

project = Xcodeproj::Project.open(proj_path)
target  = project.targets.find { |t| t.name == 'App' } or abort('App-Target nicht gefunden')

# Gruppe "App" (enthält AppDelegate etc.)
app_group = project.main_group.find_subpath('App', true)

# Schon vorhanden?
existing = app_group.files.find { |f| f.display_name == 'GoogleService-Info.plist' }
ref = existing || app_group.new_reference(plist_rel.split('/').last)

# In Resources-Build-Phase aufnehmen (nur einmal)
already = target.resources_build_phase.files_references.any? { |r| r && r.display_name == 'GoogleService-Info.plist' }
target.add_resources([ref]) unless already

project.save
puts "OK: GoogleService-Info.plist ist jetzt im App-Target (Resources)."
