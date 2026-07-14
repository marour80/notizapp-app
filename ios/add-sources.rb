#!/usr/bin/env ruby
# Fügt Swift-Dateien (Argumente, relativ zu ios/App/App/) dem App-Target hinzu (Sources-Phase).
# Nutzung: ruby ios/add-sources.rb NZRecorderPlugin.swift MainViewController.swift
require 'xcodeproj'

proj_path = File.expand_path(File.join(__dir__, 'App', 'App.xcodeproj'))
project = Xcodeproj::Project.open(proj_path)
target  = project.targets.find { |t| t.name == 'App' } or abort('App-Target nicht gefunden')
app_group = project.main_group.find_subpath('App', true)

ARGV.each do |fname|
  abs = File.expand_path(File.join(__dir__, 'App', 'App', fname))
  abort("FEHLER: #{abs} fehlt") unless File.exist?(abs)
  existing = app_group.files.find { |f| f.display_name == fname }
  ref = existing || app_group.new_reference(fname)
  already = target.source_build_phase.files_references.any? { |r| r && r.display_name == fname }
  target.add_file_references([ref]) unless already
  puts "OK: #{fname} im App-Target (Sources)."
end

project.save
