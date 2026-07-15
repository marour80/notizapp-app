#!/usr/bin/env ruby
# Erstellt das SmartNoteWidget-Extension-Target (WidgetKit) und bettet es in die App ein.
# Idempotent: läuft nur, wenn das Target noch nicht existiert.
require 'xcodeproj'

proj_path = File.expand_path(File.join(__dir__, 'App', 'App.xcodeproj'))
project = Xcodeproj::Project.open(proj_path)
app = project.targets.find { |t| t.name == 'App' } or abort('App-Target fehlt')

if project.targets.any? { |t| t.name == 'SmartNoteWidget' }
  puts 'SmartNoteWidget-Target existiert schon – nichts zu tun.'
  exit 0
end

w = project.new_target(:app_extension, 'SmartNoteWidget', :ios, '15.5')

# Dateien-Gruppe + Quelldatei
grp = project.main_group.new_group('SmartNoteWidget', 'SmartNoteWidget')
src = grp.new_reference('SmartNoteWidget.swift')
grp.new_reference('Info.plist')
grp.new_reference('SmartNoteWidget.entitlements')
w.add_file_references([src])

w.build_configurations.each do |c|
  bs = c.build_settings
  bs['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.getsmartnote.app.widget'
  bs['PRODUCT_NAME'] = '$(TARGET_NAME)'
  bs['INFOPLIST_FILE'] = 'SmartNoteWidget/Info.plist'
  bs['GENERATE_INFOPLIST_FILE'] = 'NO'
  bs['CODE_SIGN_ENTITLEMENTS'] = 'SmartNoteWidget/SmartNoteWidget.entitlements'
  bs['CODE_SIGN_STYLE'] = 'Automatic'
  bs['DEVELOPMENT_TEAM'] = '4YHU85TDWS'
  bs['SWIFT_VERSION'] = '5.0'
  bs['TARGETED_DEVICE_FAMILY'] = '1,2'
  bs['IPHONEOS_DEPLOYMENT_TARGET'] = '15.5'
  bs['MARKETING_VERSION'] = '1.7.5'
  bs['CURRENT_PROJECT_VERSION'] = '8'
  bs['SKIP_INSTALL'] = 'YES'
  bs['LD_RUNPATH_SEARCH_PATHS'] = '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'
end

# Abhängigkeit + Einbettung in die App (PlugIns)
app.add_dependency(w)
embed = app.new_copy_files_build_phase('Embed App Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
bf = embed.add_file_reference(w.product_reference)
bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts 'OK: SmartNoteWidget-Target erstellt und in App eingebettet.'
